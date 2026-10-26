import { afterAll, expect, test } from "bun:test";
import { readEnv } from "@entole/shared-kernel";
import { LIVE } from "@entole/testing";
import { SQL } from "bun";
import { PostgresMandateLock } from "../../src/index.ts";

const live = LIVE ? test : test.skip;

// Two pools stand in for two processes (the API and the workflow worker). Advisory locks need no
// schema, so this skips the throwaway-schema setup.
const pools: SQL[] = [];
const pool = () => {
  const sql = new SQL(readEnv("DATABASE_URL"), { max: 2 });
  pools.push(sql);
  return sql;
};
afterAll(async () => {
  await Promise.all(pools.map((p) => p.close()));
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

live(
  "PostgresMandateLock serialises two pools on one mandate and times out a waiter",
  async () => {
    const id = `m-live-${Math.random().toString(36).slice(2)}`;
    const api = new PostgresMandateLock(pool());
    const worker = new PostgresMandateLock(pool(), 200);
    const log: string[] = [];

    const first = api.run(id, async () => {
      log.push("api:start");
      await wait(1000);
      log.push("api:end");
    });
    await wait(300);
    // The worker gives up after 200 ms while the API holds the mandate.
    await expect(worker.run(id, async () => log.push("worker:ran"))).rejects.toThrow();
    const second = new PostgresMandateLock(pool()).run(id, async () => log.push("second:ran"));
    await Promise.all([first, second]);
    expect(log).toEqual(["api:start", "api:end", "second:ran"]);
    // Released after the throw and the timeout: the mandate locks straight away again.
    expect(await worker.run(id, async () => "free")).toBe("free");
  },
  30_000,
);
