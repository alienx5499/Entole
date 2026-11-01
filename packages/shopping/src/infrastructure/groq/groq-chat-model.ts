import type { ChatModel, ChatReply, ChatRequest } from "../../application/ports.ts";
import { type GroqConfig, GroqError, GroqKeyRing } from "./groq-agent-model.ts";

// The dashboard assistant's model. The caller's request is already shaped and capped; this adds
// the key and the model, and returns only the first choice's message.
export class GroqChatModel implements ChatModel {
  private readonly keys: GroqKeyRing;
  private readonly model: string;

  constructor(cfg: GroqConfig) {
    this.keys = new GroqKeyRing(cfg);
    this.model = cfg.model ?? "openai/gpt-oss-120b";
  }

  async complete({ max_tokens, ...req }: ChatRequest): Promise<ChatReply> {
    const res = await this.keys.post(
      JSON.stringify({ ...req, model: this.model, max_completion_tokens: max_tokens }),
    );
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
