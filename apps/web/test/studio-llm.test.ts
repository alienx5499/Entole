/// <reference types="bun" />
import { afterEach, describe, expect, test } from "bun:test";
import type { AgAiConversationItem, AgLlmRequest } from "ag-studio";
import {
  BUSY,
  fromReply,
  REFUSED,
  studioLlm,
  toBody,
  toMessages,
} from "../src/features/dashboard/studio-llm";

const user = (text: string): AgAiConversationItem => ({
  id: "u1",
  kind: "input",
  type: "message",
  role: "user",
  status: "completed",
  content: [{ type: "text", text }],
});
const call = (callId: string, name: string): AgAiConversationItem => ({
  id: `i-${callId}`,
  kind: "output",
  type: "function_call",
  callId,
  name,
  arguments: "{}",
});
const result = (callId: string): AgAiConversationItem => ({
  type: "function_call_output",
  callId,
  output: '{"ok":true}',
  status: "completed",
});
const request = (over: Partial<AgLlmRequest> = {}): AgLlmRequest => ({
  input: [user("How much did I save?")],
  instructions: "Explain savings.",
  responseFormat: { type: "text" },
  ...over,
});

describe("toMessages", () => {
  test("puts instructions first and joins consecutive tool calls into one assistant turn", () => {
    expect(
      toMessages(
        [
          user("hi"),
          call("c1", "view_schema"),
          call("c2", "savings_breakdown"),
          result("c1"),
          result("c2"),
        ],
        "sys",
      ),
    ).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "view_schema", arguments: "{}" } },
          { id: "c2", type: "function", function: { name: "savings_breakdown", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: '{"ok":true}' },
      { role: "tool", tool_call_id: "c2", content: '{"ok":true}' },
    ]);
  });
});

describe("toBody", () => {
  test("sends client tools only, maps tool choice and json format, caps tokens", () => {
    const body = toBody(
      request({
        tools: [
          { name: "savings_breakdown", description: "d", parameters: { type: "object" } },
          { name: "web_search", description: "d", parameters: {}, kind: "provided" },
        ],
        toolChoice: { name: "savings_breakdown" },
        responseFormat: { type: "json", name: "plan", schema: { type: "object" } },
      }),
    );
    expect(body).toEqual({
      messages: [
        { role: "system", content: "Explain savings." },
        { role: "user", content: "How much did I save?" },
      ],
      tools: [
        {
          type: "function",
          function: { name: "savings_breakdown", description: "d", parameters: { type: "object" } },
        },
      ],
      tool_choice: { type: "function", function: { name: "savings_breakdown" } },
      response_format: {
        type: "json_schema",
        json_schema: { name: "plan", schema: { type: "object" } },
      },
      max_tokens: 2048,
    });
  });
});

describe("fromReply", () => {
  test("streams text and tool calls and keeps them as output", () => {
    const { events, response } = fromReply("r1", {
      message: {
        content: "Checking.",
        tool_calls: [{ id: "c1", type: "function", function: { name: "t", arguments: "{}" } }],
      },
      finish_reason: "tool_calls",
    });
    expect(events.map((e) => e.type)).toEqual([
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
    ]);
    expect(response.status).toBe("completed");
    expect(response.output.map((o) => o.type)).toEqual(["message", "function_call"]);
  });

  test("a reply cut at the token cap is incomplete", () => {
    const { response } = fromReply("r1", { message: { content: "Half" }, finish_reason: "length" });
    expect(response.status).toBe("incomplete");
    expect(response.incompleteDetails).toEqual({ reason: "max_output_tokens" });
  });
});

describe("studioLlm", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const answer = async (status: number, body: unknown = {}) => {
    const sent: RequestInit[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sent.push(init);
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    const turn = studioLlm.executeTurn(request());
    const events = [];
    for await (const e of turn.stream) events.push(e);
    return { sent, events, response: await turn.complete };
  };
  const text = (r: Awaited<ReturnType<typeof answer>>) =>
    r.events.flatMap((e) => (e.type === "TEXT_MESSAGE_CONTENT" ? [e.delta] : [])).join("");

  test("posts to the same-origin route with the session cookie", async () => {
    const r = await answer(200, {
      message: { content: "You saved $12.00." },
      finish_reason: "stop",
    });
    expect(r.sent[0]?.credentials).toBe("same-origin");
    expect(text(r)).toBe("You saved $12.00.");
  });

  test("a 5xx ends the turn with a short note instead of an error", async () => {
    for (const status of [500, 502]) {
      const r = await answer(status);
      expect(text(r)).toBe(BUSY);
      expect(r.response.status).toBe("completed");
    }
    expect(text(await answer(413))).toBe(REFUSED);
  });

  // Each reply in turn; a 429 says to wait 0 s so the test does not sleep.
  const replies = (statuses: number[]) => {
    let i = 0;
    globalThis.fetch = (async () => {
      const status = statuses[i++] ?? 200;
      return status === 429
        ? new Response("{}", { status, headers: { "retry-after": "0" } })
        : new Response(JSON.stringify({ message: { content: "Added." }, finish_reason: "stop" }));
    }) as unknown as typeof fetch;
    return () => i;
  };

  test("a 429 waits and retries the same turn", async () => {
    const calls = replies([429, 429, 200]);
    const out = await studioLlm.executeTurn(request()).complete;
    expect(calls()).toBe(3);
    expect(out.status).toBe("completed");
    expect(out.output[0]).toMatchObject({ type: "message", content: [{ text: "Added." }] });
  });

  test("still rate limited after three retries, the turn fails so no agent reports success", async () => {
    const calls = replies([429, 429, 429, 429]);
    const turn = studioLlm.executeTurn(request());
    const events = [];
    for await (const e of turn.stream) events.push(e);
    const out = await turn.complete;
    expect(calls()).toBe(4);
    expect(events).toEqual([]);
    expect(out.status).toBe("failed");
    expect(out.error).toEqual({ code: "rate_limited", message: BUSY });
  });

  test("a dropped connection is a note too", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    const turn = studioLlm.executeTurn(request());
    const out = await turn.complete;
    expect(out.output[0]).toMatchObject({ type: "message", content: [{ text: BUSY }] });
  });
});
