import { expect, test } from "bun:test";
import type { SQL } from "bun";
import { PostgresMandateLock } from "../../src/index.ts";

// Records what the lock asks of Postgres: the transaction, each query, and how it ended.
const fakeSql = () => {
  const log: string[] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    log.push(`${strings.join("?").replace(/\s+/g, " ").trim()} [${values.join(",")}]`);
    return Promise.resolve([]);
  };
  const sql = {
    begin: async (fn: (t: typeof tx) => Promise<unknown>) => {
      log.push("begin");
      try {
        const r = await fn(tx);
        log.push("commit");
        return r;
      } catch (e) {
        log.push("rollback");
        throw e;
      }
    },
  };
  return { log, sql: sql as unknown as SQL };
};

test("PostgresMandateLock takes the advisory lock before fn and releases it after", async () => {
  const { log, sql } = fakeSql();
  const lock = new PostgresMandateLock(sql, 5000);
  const r = await lock.run("m1", async () => {
    log.push("fn");
    return 42;
  });
  expect(r).toBe(42);
  expect(log).toEqual([
    "begin",
    "select set_config('lock_timeout', ?, true) [5000ms]",
    "select pg_advisory_xact_lock(hashtext(?)) [m1]",
    "fn",
    "commit",
  ]);
});

test("PostgresMandateLock releases the lock and rethrows when fn throws", async () => {
  const { log, sql } = fakeSql();
  const lock = new PostgresMandateLock(sql);
  await expect(
    lock.run("m1", async () => {
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect(log.at(-1)).toBe("rollback");
  expect(log.filter((l) => l === "begin")).toHaveLength(1);
});
