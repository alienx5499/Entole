import type { Taste } from "../domain/taste.ts";

export type AgentToolCall = { id: string; name: string; argsJson: string };
export type AgentMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: AgentToolCall[];
};
export type AgentToolSpec = { name: string; description: string; parameters: object };

export interface AgentModel {
  next(
    messages: AgentMessage[],
    tools: AgentToolSpec[],
  ): Promise<{ kind: "tools"; calls: AgentToolCall[] } | { kind: "final"; text: string }>;
}

export interface TasteRepository {
  get(userId: string): Promise<Taste | null>;
  save(userId: string, t: Taste): Promise<void>;
}

// One chat turn for the dashboard assistant, in the OpenAI chat-completions shape. The model is
// chosen by the adapter, never by the caller.
export type ChatToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ChatTool = {
  type: "function";
  function: { name: string; description: string; parameters: object };
};
export type ChatRequest = {
  messages: ChatMessage[];
  tools?: ChatTool[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  response_format?:
    | { type: "text" }
    | { type: "json_schema"; json_schema: { name: string; schema: object } };
  max_tokens: number;
};
export type ChatReply = {
  message: { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] };
  finish_reason: string;
};

export interface ChatModel {
  complete(req: ChatRequest): Promise<ChatReply>;
}

// One row per configured model key, by slot (1-based). Never the key or any part of it.
export type KeyHealth = {
  slot: number;
  ok: boolean;
  status: number; // 0 when no answer came back
  latencyMs: number;
  error?: string;
};

export interface KeyHealthCheck {
  check(): Promise<KeyHealth[]>;
}
