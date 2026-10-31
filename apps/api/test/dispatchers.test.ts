import { expect, test } from "bun:test";
import { InProcessDispatcher, RenderWorkflowDispatcher } from "../src/workflows/dispatchers.ts";

// The SDK's StartTaskOptions, which its package does not export.
type StartTaskOptions = { signal?: AbortSignal; idempotencyKey?: string };

test("RenderWorkflowDispatcher starts slug/checkMandate with the id and a per-event idempotency key", async () => {
  const calls: unknown[][] = [];
  const client = {
    workflows: {
      startTask: async (slug: string, input: unknown[], options?: unknown) => {
        const { signal, idempotencyKey } = options as StartTaskOptions;
        calls.push([slug, input, idempotencyKey, signal instanceof AbortSignal]);
        return {} as never;
      },
    },
  };
  await new RenderWorkflowDispatcher("entole-watcher", client, 10).dispatch("m1", {
    eventId: "evt_1",
  });
  expect(calls).toEqual([["entole-watcher/checkMandate", ["m1", "evt_1"], "c3:evt_1:m1", true]]);
});

test("RenderWorkflowDispatcher rejects when Render never answers", async () => {
  const client = {
    workflows: {
      startTask: (_slug: string, _input: unknown[], options?: unknown) =>
        new Promise<never>((_, reject) =>
          (options as StartTaskOptions).signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
    },
  };
  await expect(
    new RenderWorkflowDispatcher("entole-watcher", client, 10).dispatch("m1", { eventId: "evt_1" }),
  ).rejects.toThrow("aborted");
});

test("InProcessDispatcher resolves before the tick finishes", async () => {
  let finish = () => {};
  let finished = false;
  const check = (_id: string) =>
    new Promise<void>((resolve) => {
      finish = () => {
        finished = true;
        resolve();
      };
    });
  await new InProcessDispatcher(check).dispatch("m1", { eventId: "evt_1" });
  expect(finished).toBe(false);
  finish();
});

test("InProcessDispatcher logs a failed tick instead of throwing", async () => {
  const logged: unknown[] = [];
  const errors = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  await new InProcessDispatcher(async () => {
    throw new Error("boom");
  }).dispatch("m1", { eventId: "evt_1" });
  await Bun.sleep(0);
  console.error = errors;
  expect(logged).toHaveLength(1);
});
