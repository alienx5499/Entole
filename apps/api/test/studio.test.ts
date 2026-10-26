import { expect, test } from "bun:test";
import { GroqError, RateLimited } from "@entole/shopping";
import { ScriptedChatModel } from "@entole/testing";
import { harness, login } from "./harness.ts";

const tool = (name: string) => ({
  type: "function" as const,
  function: { name, description: "d", parameters: { type: "object" } },
});
const turn = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    messages: [
      { role: "system", content: "You explain savings." },
      { role: "user", content: "How much did I save?" },
    ],
    tools: [tool("savings_breakdown")],
    ...over,
  });
const post = (h: ReturnType<typeof harness>, body: string, cookie?: string) =>
  h.call("/api/studio/chat", { method: "POST", body, cookie });

test("studio chat needs a session and never reaches the model without one", async () => {
  const h = harness();
  const res = await post(h, turn());
  expect(res.status).toBe(401);
  expect((h.c.chat as ScriptedChatModel).seen).toEqual([]);
});

test("studio chat forwards only the chat shape and returns the reply", async () => {
  const h = harness();
  const chat = new ScriptedChatModel([
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "savings_breakdown", arguments: "{}" } },
        ],
      },
      finish_reason: "tool_calls",
    },
  ]);
  h.c.chat = chat;
  const cookie = await login(h);
  const res = await post(
    h,
    turn({ model: "some-other-model", temperature: 2, stream: true, max_tokens: 99_999 }),
    cookie,
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    message: {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "c1", type: "function", function: { name: "savings_breakdown", arguments: "{}" } },
      ],
    },
    finish_reason: "tool_calls",
  });
  // The model, sampling and streaming are the server's; max_tokens is capped.
  expect(chat.seen).toEqual([
    {
      messages: [
        { role: "system", content: "You explain savings." },
        { role: "user", content: "How much did I save?" },
      ],
      tools: [tool("savings_breakdown")],
      max_tokens: 4096,
    },
  ]);
});

test("studio chat keeps the tool round trip and defaults max_tokens", async () => {
  const h = harness();
  const cookie = await login(h);
  const messages = [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "c1", type: "function", function: { name: "view_schema", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "c1", content: "{}" },
  ];
  const res = await post(h, turn({ messages, tool_choice: "auto" }), cookie);
  expect(res.status).toBe(200);
  const [seen] = (h.c.chat as ScriptedChatModel).seen;
  expect(seen?.messages as unknown).toEqual(messages);
  expect(seen?.tool_choice).toBe("auto");
  expect(seen?.max_tokens).toBe(2048);
});

test("studio chat refuses tools Studio does not ship, bad messages and oversize bodies", async () => {
  const h = harness();
  const cookie = await login(h);
  const cases: [string, number, string][] = [
    [turn({ tools: [tool("send_email")] }), 400, "tools"],
    [
      turn({ tool_choice: { type: "function", function: { name: "send_email" } } }),
      400,
      "tool_choice",
    ],
    [turn({ messages: [] }), 400, "messages"],
    [turn({ messages: [{ role: "developer", content: "x" }] }), 400, "messages"],
    [turn({ messages: Array(81).fill({ role: "user", content: "x" }) }), 400, "messages"],
    [turn({ tools: Array(33).fill(tool("view_schema")) }), 400, "tools"],
    [turn({ max_tokens: 0 }), 400, "max_tokens"],
  ];
  for (const [body, status, field] of cases) {
    const res = await post(h, body, cookie);
    expect(res.status).toBe(status);
    expect(((await res.json()) as { field?: string }).field).toBe(field);
  }
  const big = turn({ messages: [{ role: "user", content: "x".repeat(300_000) }] });
  expect((await post(h, big, cookie)).status).toBe(413);
  expect((await post(h, "{not json", cookie)).status).toBe(400);
  expect((h.c.chat as ScriptedChatModel).seen).toEqual([]);
});

test("studio chat is rate limited per user", async () => {
  const h = harness();
  const cookie = await login(h);
  const other = await login(h, "other-buyer");
  for (let i = 0; i < 30; i++) expect((await post(h, turn(), cookie)).status).toBe(200);
  const limited = await post(h, turn(), cookie);
  expect(limited.status).toBe(429);
  expect(await limited.json()).toEqual({ error: "rate_limited" });
  expect((await post(h, turn(), other)).status).toBe(200);
});

test("upstream failures map to 429, 502 and 500 without detail", async () => {
  const h = harness();
  h.c.chat = new ScriptedChatModel([
    new RateLimited(),
    new GroqError(503),
    new Error("key sk-secret rejected"),
  ]);
  const cookie = await login(h);
  const first = await post(h, turn(), cookie);
  expect(first.status).toBe(429);
  expect(await first.json()).toEqual({ error: "upstream_rate_limited" });
  const second = await post(h, turn(), cookie);
  expect(second.status).toBe(502);
  expect(await second.json()).toEqual({ error: "upstream_error" });
  const third = await post(h, turn(), cookie);
  expect(third.status).toBe(500);
  expect(await third.text()).not.toContain("sk-secret");
});
