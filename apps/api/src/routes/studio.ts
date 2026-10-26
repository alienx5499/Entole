import type { ChatMessage, ChatRequest, ChatTool, ChatToolCall } from "@entole/shopping";
import { HttpError, json } from "../http/http.ts";
import type { Route } from "../http/router.ts";
import { requireUserId } from "./auth.ts";

// The dashboard's AI panel runs its agents in the browser and sends each model turn here, so the
// Groq key never leaves the server. Only the chat shape below is forwarded: the model, sampling
// and every other provider option are fixed server-side.

// Studio's built-in agents send long instructions and a dozen tool schemas on every turn.
const MAX_BODY = 256_000;
const MAX_MESSAGES = 80;
const MAX_TOOLS = 32;
const MAX_TOKENS = 4096;
const DEFAULT_TOKENS = 2048;

// The tools AG Studio 3.0.0 gives its agents, plus the dashboard's own. Anything else is refused,
// so this route cannot be used as a general tool-calling proxy.
const STUDIO_TOOLS = new Set([
  "view_schema",
  "view_report",
  "view_page",
  "view_widget",
  "execute_query",
  "create_expression",
  "update_expression",
  "delete_expression",
  "add_widget",
  "position_widget",
  "remove_widget",
  "add_page_filter",
  "remove_page_filter",
  "add_widget_filter",
  "remove_widget_filter",
  "configure_widget",
  "view_plan",
  "create_plan",
  "update_plan",
  "clear_plan",
  "rename_thread",
  "delegate_to",
  "complete_task",
  "savings_breakdown",
]);

const invalid = (field: string): never => {
  throw new HttpError(400, "invalid_field", { field });
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown, field: string): string => (typeof v === "string" ? v : invalid(field));

const toolName = (v: unknown, field: string): string => {
  const name = str(v, field);
  return STUDIO_TOOLS.has(name) ? name : invalid(field);
};

const toolCall = (v: unknown): ChatToolCall => {
  if (!isObject(v) || !isObject(v.function)) return invalid("messages");
  return {
    id: str(v.id, "messages"),
    type: "function",
    function: {
      name: toolName(v.function.name, "messages"),
      arguments: str(v.function.arguments, "messages"),
    },
  };
};

const message = (v: unknown): ChatMessage => {
  if (!isObject(v)) return invalid("messages");
  switch (v.role) {
    case "system":
    case "user":
      return { role: v.role, content: str(v.content, "messages") };
    case "tool":
      return {
        role: "tool",
        tool_call_id: str(v.tool_call_id, "messages"),
        content: str(v.content, "messages"),
      };
    case "assistant": {
      const content =
        v.content === null || v.content === undefined ? null : str(v.content, "messages");
      if (v.tool_calls === undefined) return { role: "assistant", content };
      if (!Array.isArray(v.tool_calls) || v.tool_calls.length > MAX_TOOLS)
        return invalid("messages");
      return { role: "assistant", content, tool_calls: v.tool_calls.map(toolCall) };
    }
    default:
      return invalid("messages");
  }
};

const tool = (v: unknown): ChatTool => {
  if (!isObject(v) || v.type !== "function" || !isObject(v.function)) return invalid("tools");
  const f = v.function;
  if (!isObject(f.parameters)) return invalid("tools");
  return {
    type: "function",
    function: {
      name: toolName(f.name, "tools"),
      description: str(f.description, "tools"),
      parameters: f.parameters,
    },
  };
};

const toolChoice = (v: unknown): ChatRequest["tool_choice"] => {
  if (v === undefined || v === "auto" || v === "none" || v === "required") return v;
  if (isObject(v) && v.type === "function" && isObject(v.function))
    return { type: "function", function: { name: toolName(v.function.name, "tool_choice") } };
  return invalid("tool_choice");
};

const responseFormat = (v: unknown): ChatRequest["response_format"] => {
  if (v === undefined) return undefined;
  if (isObject(v) && v.type === "text") return { type: "text" };
  if (isObject(v) && v.type === "json_schema" && isObject(v.json_schema)) {
    const { name, schema } = v.json_schema;
    if (!isObject(schema)) return invalid("response_format");
    return { type: "json_schema", json_schema: { name: str(name, "response_format"), schema } };
  }
  return invalid("response_format");
};

const maxTokens = (v: unknown): number => {
  if (v === undefined) return DEFAULT_TOKENS;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return invalid("max_tokens");
  return Math.min(v, MAX_TOKENS);
};

export const parseStudioChat = (body: unknown): ChatRequest => {
  if (!isObject(body)) return invalid("body");
  const { messages, tools } = body;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES)
    return invalid("messages");
  if (tools !== undefined && (!Array.isArray(tools) || tools.length > MAX_TOOLS))
    return invalid("tools");
  const req: ChatRequest = {
    messages: messages.map(message),
    max_tokens: maxTokens(body.max_tokens),
  };
  if (tools?.length) req.tools = tools.map(tool);
  const choice = toolChoice(body.tool_choice);
  if (choice) req.tool_choice = choice;
  const format = responseFormat(body.response_format);
  if (format) req.response_format = format;
  return req;
};

const readCapped = async (req: Request): Promise<unknown> => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY)
    throw new HttpError(413, "body_too_large");
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, "body_too_large");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
};

const chat: Route[2] = async (ctx) => {
  const userId = await requireUserId(ctx);
  if (!ctx.limits.studio.every((l) => l.hit(userId))) throw new HttpError(429, "rate_limited");
  const req = parseStudioChat(await readCapped(ctx.req));
  return json(await ctx.c.chat.complete(req));
};

export const studioRoutes: Route[] = [["POST", "/api/studio/chat", chat]];
