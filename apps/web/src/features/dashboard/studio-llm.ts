// The LLM behind every agent in the dashboard's AI panel. Studio runs the agents in the browser
// and calls `executeTurn` once per model turn; each turn goes to our own API (same origin, session
// cookie), which adds the Groq key. One JSON request per turn, so the stream is replayed from the
// finished reply rather than read from the wire.

import type {
  AgAiConversationItem,
  AgAiEvent,
  AgAiOutputItem,
  AgLlmAdapter,
  AgLlmRequest,
  AgLlmResponse,
} from "ag-studio";

// Mirrors the API's chat shape (docs/API_CONTRACT.md, POST /api/studio/chat).
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type Reply = {
  message: { content: string | null; tool_calls?: ToolCall[] };
  finish_reason: string;
};

const MAX_TOKENS = 2048;
export const BUSY =
  "The assistant is busy right now. Try again in a minute; your dashboard still works.";
export const REFUSED = "The assistant could not take that request. Start a new chat and try again.";

/** Studio's conversation as chat messages. Consecutive tool calls share one assistant message. */
export function toMessages(items: AgAiConversationItem[], instructions?: string): Message[] {
  const out: Message[] = instructions ? [{ role: "system", content: instructions }] : [];
  for (const item of items) {
    if (item.type === "reasoning") continue;
    if (item.type === "function_call_output") {
      out.push({ role: "tool", tool_call_id: item.callId, content: item.output });
    } else if (item.type === "function_call") {
      const call: ToolCall = {
        id: item.callId,
        type: "function",
        function: { name: item.name, arguments: item.arguments || "{}" },
      };
      const last = out.at(-1);
      if (last?.role === "assistant") last.tool_calls = [...(last.tool_calls ?? []), call];
      else out.push({ role: "assistant", content: null, tool_calls: [call] });
    } else if (item.kind === "input") {
      const text = item.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");
      out.push({ role: item.role, content: text });
    } else {
      const text = item.content.map((c) => (c.type === "text" ? c.text : c.refusal)).join("\n");
      out.push({ role: "assistant", content: text });
    }
  }
  return out;
}

export function toBody(req: AgLlmRequest) {
  const tools = (req.tools ?? [])
    .filter((t) => (t.kind ?? "client") === "client")
    .map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  const choice = req.toolChoice;
  return {
    messages: toMessages(req.input, req.instructions),
    ...(tools.length > 0 && {
      tools,
      ...(choice && {
        tool_choice:
          typeof choice === "string"
            ? choice
            : { type: "function", function: { name: choice.name } },
      }),
    }),
    ...(req.responseFormat.type === "json" && {
      response_format: {
        type: "json_schema",
        json_schema: { name: req.responseFormat.name, schema: req.responseFormat.schema },
      },
    }),
    max_tokens: MAX_TOKENS,
  };
}

/** A reply as the events Studio streams into the panel and the output items it keeps. */
export function fromReply(
  id: string,
  reply: Reply,
): { events: AgAiEvent[]; response: AgLlmResponse } {
  const events: AgAiEvent[] = [];
  const output: AgAiOutputItem[] = [];
  const text = reply.message.content?.trim();
  if (text) {
    const messageId = `${id}-text`;
    events.push(
      { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId, delta: text },
      { type: "TEXT_MESSAGE_END", messageId },
    );
    output.push({
      id: messageId,
      kind: "output",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "text", text, annotations: [] }],
    });
  }
  for (const call of reply.message.tool_calls ?? []) {
    const { name, arguments: args } = call.function;
    events.push(
      { type: "TOOL_CALL_START", toolCallId: call.id, toolCallName: name },
      { type: "TOOL_CALL_ARGS", toolCallId: call.id, delta: args },
      { type: "TOOL_CALL_END", toolCallId: call.id },
    );
    output.push({
      id: `${id}-${call.id}`,
      kind: "output",
      type: "function_call",
      callId: call.id,
      name,
      arguments: args,
      status: "completed",
    });
  }
  const cut = reply.finish_reason === "length";
  return {
    events,
    response: {
      id,
      createdAt: Date.now(),
      output,
      status: cut ? "incomplete" : "completed",
      ...(cut && { incompleteDetails: { reason: "max_output_tokens" as const } }),
    },
  };
}

async function turn(req: AgLlmRequest, signal?: AbortSignal) {
  const id = crypto.randomUUID();
  // A 429, a 5xx or a dropped connection ends the turn with a short note in the panel instead of
  // an error, so a busy model never takes the dashboard down with it.
  const note = (content: string) => fromReply(id, { message: { content }, finish_reason: "stop" });
  let res: Response;
  try {
    res = await fetch("/api/studio/chat", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toBody(req)),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    return note(BUSY);
  }
  if (res.status === 401) {
    window.location.href = "/?login=1";
    throw new Error("signed out");
  }
  if (!res.ok) return note(res.status === 429 || res.status >= 500 ? BUSY : REFUSED);
  return fromReply(id, (await res.json()) as Reply);
}

export const studioLlm: AgLlmAdapter = {
  executeTurn(req, options) {
    const done = turn(req, options?.signal);
    const complete = done.then((d) => d.response);
    // Studio may read only one of the two; the other must not surface as an unhandled rejection.
    complete.catch(() => {});
    return {
      stream: {
        async *[Symbol.asyncIterator]() {
          yield* (await done).events;
        },
      },
      complete,
    };
  },
};
