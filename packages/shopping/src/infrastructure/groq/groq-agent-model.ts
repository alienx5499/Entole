import type { AgentMessage, AgentModel, AgentToolSpec } from "../../application/ports.ts";

// A hung upstream call must not hold a mandate lock or a request forever.
export const GROQ_TIMEOUT_MS = 30_000;

export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

type Config = { apiKey: string; model?: string; fetch?: typeof fetch };

export class RateLimited extends Error {
  constructor() {
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
  private readonly http: typeof fetch;
  private readonly model: string;

  constructor(private readonly cfg: Config) {
    this.http = cfg.fetch ?? fetch;
    this.model = cfg.model ?? "openai/gpt-oss-120b";
  }

  async next(messages: AgentMessage[], tools: AgentToolSpec[]) {
    const res = await this.http(GROQ_URL, {
      method: "POST",
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${this.cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(toOpenAi),
        tools: tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        tool_choice: "auto",
      }),
    });
    if (res.status === 429) throw new RateLimited();
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
