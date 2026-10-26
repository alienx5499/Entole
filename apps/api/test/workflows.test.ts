import { expect, test } from "bun:test";
import { parseWatcherMode } from "../src/jobs/watcher-mode.ts";
import { type CheckResult, checkMandate, watchLimitOrders } from "../src/workflows/watch-tasks.ts";
import { harness } from "./harness.ts";

test("watcher mode defaults to timer and rejects unknown values", () => {
  expect(parseWatcherMode(undefined)).toBe("timer");
  expect(parseWatcherMode("")).toBe("timer");
  expect(parseWatcherMode("timer")).toBe("timer");
  expect(parseWatcherMode("workflow")).toBe("workflow");
  expect(() => parseWatcherMode("cron")).toThrow("WATCHER_MODE");
});

test("the parent task runs no child while no limit mandate is funded", async () => {
  const h = harness();
  const calls: string[] = [];
  const out = await watchLimitOrders(h.c, async (id) => {
    calls.push(id);
    return { checked: 1, captured: [] };
  });
  expect(calls).toEqual([]);
  expect(out).toEqual({ mandates: 0, checked: 0, captured: [], failed: 0 });
});

test("the parent task fans out per funded mandate and survives a failed child", async () => {
  const h = harness();
  const ids = ["m1", "m2", "m3"];
  h.c.repo.listFundedLimit = async () => ids.map((id) => ({ id }) as never);
  const run = async (id: string): Promise<CheckResult> => {
    if (id === "m2") throw new Error("boom");
    return { checked: 1, captured: id === "m3" ? [id] : [] };
  };
  const errors = console.error;
  console.error = () => {};
  const out = await watchLimitOrders(h.c, run).finally(() => {
    console.error = errors;
  });
  expect(out).toEqual({ mandates: 3, checked: 2, captured: ["m3"], failed: 1 });
});

test("the child task checks one mandate and reports nothing for an unknown id", async () => {
  const h = harness();
  expect(await checkMandate(h.c, "missing")).toEqual({ checked: 0, captured: [] });
});
