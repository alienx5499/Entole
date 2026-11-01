import type { ChatModel, ChatReply, ChatRequest } from "../../application/ports.ts";
import { GROQ_TIMEOUT_MS, GROQ_URL, GroqError, RateLimited } from "./groq-agent-model.ts";

type Config = { apiKey: string; model?: string; fetch?: typeof fetch };

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

// The dashboard assistant's model. The caller's request is already shaped and capped; this adds
// the key and the model, and returns only the first choice's message.
export class GroqChatModel implements ChatModel {
  private readonly http: typeof fetch;
  private readonly model: string;

  constructor(private readonly cfg: Config) {
    this.http = cfg.fetch ?? fetch;
    this.model = cfg.model ?? "openai/gpt-oss-120b";
  }

  async complete({ max_tokens, ...req }: ChatRequest): Promise<ChatReply> {
    const res = await this.http(GROQ_URL, {
      method: "POST",
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${this.cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...req, model: this.model, max_completion_tokens: max_tokens }),
    });
    if (res.status === 429) throw new RateLimited(retryAfterSec(res.headers));
    if (!res.ok) throw new GroqError(res.status);
    const body = (await res.json()) as {
      choices: { message: ChatReply["message"]; finish_reason?: string }[];
    };
    const choice = body.choices[0];
    if (!choice) throw new GroqError(502);
    // Rebuilt field by field so nothing else Groq returns (reasoning, usage) reaches the browser.
    const { content, tool_calls } = choice.message;
    const calls = (tool_calls ?? []).map((c) => ({
      id: c.id,
      type: "function" as const,
      function: { name: c.function.name, arguments: c.function.arguments },
    }));
    return {
      message: {
        role: "assistant",
        content: content ?? null,
        ...(calls.length && { tool_calls: calls }),
      },
      finish_reason: choice.finish_reason ?? "stop",
    };
  }
}
