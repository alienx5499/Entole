import { describe, expect, test } from "bun:test";
import { GroqAgentModel, GroqChatModel, GroqError, RateLimited } from "../../src/index.ts";

const setup = (res: () => Response, model?: string) => {
  // biome-ignore lint/suspicious/noExplicitAny: parsed JSON request bodies are untyped
  const bodies: any[] = [];
  const stub = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    return res();
  }) as unknown as typeof fetch;
  return { model: new GroqAgentModel({ apiKey: "fake", model, fetch: stub }), bodies };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const tools = [{ name: "search_products", description: "d", parameters: { type: "object" } }];

describe("GroqAgentModel", () => {
  test("maps tool_calls to kind tools", async () => {
    const { model } = setup(() =>
      json({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "c1",
                  type: "function",
                  function: { name: "search_products", arguments: '{"query":"shoes"}' },
                },
              ],
            },
          },
        ],
      }),
    );
    expect(await model.next([{ role: "user", content: "hi" }], tools)).toEqual({
      kind: "tools",
      calls: [{ id: "c1", name: "search_products", argsJson: '{"query":"shoes"}' }],
    });
  });

  test("maps content-only response to final", async () => {
    const { model } = setup(() => json({ choices: [{ message: { content: "done" } }] }));
    expect(await model.next([{ role: "user", content: "hi" }], tools)).toEqual({
      kind: "final",
      text: "done",
    });
  });

  test("sends model, tools, tool_choice and maps assistant tool_calls and tool role", async () => {
    const { model, bodies } = setup(() => json({ choices: [{ message: { content: "ok" } }] }));
    await model.next(
      [
        { role: "system", content: "s" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "c1", name: "search_products", argsJson: "{}" }],
        },
        { role: "tool", content: "[]", toolCallId: "c1" },
      ],
      tools,
    );
    expect(bodies[0].model).toBe("openai/gpt-oss-120b");
    expect(bodies[0].tool_choice).toBe("auto");
    expect(bodies[0].tools[0]).toEqual({
      type: "function",
      function: { name: "search_products", description: "d", parameters: { type: "object" } },
    });
    expect(bodies[0].messages).toEqual([
      { role: "system", content: "s" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "search_products", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "[]" },
    ]);
  });

  test("model comes from the constructor", async () => {
    const { model, bodies } = setup(
      () => json({ choices: [{ message: { content: "ok" } }] }),
      "other/model",
    );
    await model.next([], tools);
    expect(bodies[0].model).toBe("other/model");
  });

  test("429 throws RateLimited", async () => {
    const { model } = setup(() => json({}, 429));
    await expect(model.next([], tools)).rejects.toBeInstanceOf(RateLimited);
  });
});

describe("GroqChatModel", () => {
  const chatSetup = (res: () => Response) => {
    // biome-ignore lint/suspicious/noExplicitAny: parsed JSON request bodies are untyped
    const calls: { headers: any; body: any }[] = [];
    const stub = (async (_url: string, init: RequestInit) => {
      calls.push({ headers: init.headers, body: JSON.parse(init.body as string) });
      return res();
    }) as unknown as typeof fetch;
    return { chat: new GroqChatModel({ apiKey: "fake-key", fetch: stub }), calls };
  };
  const req = { messages: [{ role: "user" as const, content: "hi" }], max_tokens: 100 };

  test("adds key and model, renames max_tokens and strips extra reply fields", async () => {
    const { chat, calls } = chatSetup(() =>
      json({
        usage: { total_tokens: 9 },
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              reasoning: "private",
              content: null,
              tool_calls: [
                { id: "c1", index: 0, type: "function", function: { name: "t", arguments: "{}" } },
              ],
            },
          },
        ],
      }),
    );
    expect(await chat.complete(req)).toEqual({
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "t", arguments: "{}" } }],
      },
      finish_reason: "tool_calls",
    });
    expect(calls[0]?.headers.Authorization).toBe("Bearer fake-key");
    expect(calls[0]?.body).toEqual({
      messages: req.messages,
      model: "openai/gpt-oss-120b",
      max_completion_tokens: 100,
    });
  });

  test("429 throws RateLimited and other failures throw GroqError", async () => {
    await expect(chatSetup(() => json({}, 429)).chat.complete(req)).rejects.toBeInstanceOf(
      RateLimited,
    );
    await expect(chatSetup(() => json({}, 500)).chat.complete(req)).rejects.toBeInstanceOf(
      GroqError,
    );
  });

  test("a 429 carries Groq's wait, from Retry-After or else the token or request reset", async () => {
    const waitFor = async (headers: Record<string, string>) => {
      const res = () => new Response("{}", { status: 429, headers });
      const err = await chatSetup(res)
        .chat.complete(req)
        .catch((e) => e);
      expect(err).toBeInstanceOf(RateLimited);
      return (err as RateLimited).retryAfterSec;
    };
    expect(await waitFor({ "retry-after": "7" })).toBe(7);
    expect(await waitFor({ "x-ratelimit-reset-tokens": "7.66s" })).toBe(8);
    expect(await waitFor({ "x-ratelimit-reset-requests": "1m2.5s" })).toBe(63);
    expect(await waitFor({ "x-ratelimit-reset-tokens": "450ms" })).toBe(1);
    expect(await waitFor({})).toBeUndefined();
  });
});
