import type { AgentMessage, AgentModel, AgentToolSpec } from "../../application/ports.ts";

// A hung upstream call must not hold a mandate lock or a request forever.
export const GROQ_TIMEOUT_MS = 30_000;

export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// The Groq keys configured for this deployment, used in turn.
export type GroqConfig = {
  apiKeys: readonly [string, ...string[]];
  model?: string;
  fetch?: typeof fetch;
  now?: () => number;
};

export class RateLimited extends Error {
  /** How long Groq asked us to wait, in whole seconds, when it said. */
  constructor(readonly retryAfterSec?: number) {
    super("Groq rate limit reached (429)");
    this.name = "RateLimited";
  }
}

export class GroqError extends Error {
  constructor(readonly status: number) {
    super(`Groq request failed: status ${status}`);
    this.name = "GroqError";
  }
}

// Groq sends Retry-After in seconds on most 429s; otherwise its reset headers read like "7.66s",
// "1m2.5s" or "450ms". Rounded up so a client never retries a moment too early.
const retryAfterSec = (h: Headers): number | undefined => {
  const after = Number(h.get("retry-after") ?? Number.NaN);
  if (Number.isFinite(after) && after >= 0) return Math.ceil(after);
  const reset = h.get("x-ratelimit-reset-tokens") ?? h.get("x-ratelimit-reset-requests");
  if (!reset) return undefined;
  const unit = { h: 3600, m: 60, s: 1, ms: 0.001 } as const;
  let sec = 0;
  for (const [, n, u] of reset.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g))
    sec += Number(n) * unit[u as keyof typeof unit];
  return sec > 0 ? Math.ceil(sec) : undefined;
};

// Round-robin per call. A 429 moves the same request to the next key, each key at most once, and
// a key whose Retry-After window is still open is skipped. Only when every key is rate limited does
// it throw, with the shortest wait seen.
export class GroqKeyRing {
  private turn = 0;
  private readonly coolUntil = new Map<number, number>();
  private readonly http: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly cfg: GroqConfig) {
    this.http = cfg.fetch ?? fetch;
    this.now = cfg.now ?? Date.now;
  }

  async post(body: string): Promise<Response> {
    const keys = this.cfg.apiKeys;
    const start = this.turn++;
    let wait: number | undefined;
    const sooner = (sec: number | undefined) => {
      if (sec !== undefined) wait = wait === undefined ? sec : Math.min(wait, sec);
    };
    for (let i = 0; i < keys.length; i++) {
      const slot = (start + i) % keys.length;
      const until = this.coolUntil.get(slot) ?? 0;
      if (until > this.now()) {
        sooner(Math.ceil((until - this.now()) / 1000));
        continue;
      }
      const res = await this.http(GROQ_URL, {
        method: "POST",
        signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${keys[slot]}`, "Content-Type": "application/json" },
        body,
      });
      if (res.status !== 429) return res;
      const sec = retryAfterSec(res.headers);
      if (sec) this.coolUntil.set(slot, this.now() + sec * 1000);
      sooner(sec);
    }
    throw new RateLimited(wait);
  }
}

const toOpenAi = (m: AgentMessage) => {
  if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  if (m.role === "assistant" && m.toolCalls?.length)
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.argsJson },
      })),
    };
  return { role: m.role, content: m.content };
};

export class GroqAgentModel implements AgentModel {
  private readonly keys: GroqKeyRing;
  private readonly model: string;

  constructor(cfg: GroqConfig) {
    this.keys = new GroqKeyRing(cfg);
    this.model = cfg.model ?? "openai/gpt-oss-120b";
  }

  async next(messages: AgentMessage[], tools: AgentToolSpec[]) {
    const res = await this.keys.post(
      JSON.stringify({
        model: this.model,
        messages: messages.map(toOpenAi),
        tools: tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        tool_choice: "auto",
      }),
    );
    if (!res.ok) throw new GroqError(res.status);
    const body = (await res.json()) as {
      choices: {
        message: {
          content?: string | null;
          tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        };
      }[];
    };
    const msg = body.choices[0]?.message;
    if (!msg) throw new Error("Groq response has no choices");
    if (msg.tool_calls?.length)
      return {
        kind: "tools" as const,
        calls: msg.tool_calls.map((c) => ({
          id: c.id,
          name: c.function.name,
          argsJson: c.function.arguments,
        })),
      };
    return { kind: "final" as const, text: msg.content ?? "" };
  }
}
