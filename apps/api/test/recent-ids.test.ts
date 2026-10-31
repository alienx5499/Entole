import { expect, test } from "bun:test";
import { RecentIds } from "../src/http/recent-ids.ts";

test("recent ids expire after the ttl and drop the oldest over capacity", () => {
  const t0 = new Date("2026-11-01T00:00:00Z");
  const later = (ms: number) => new Date(t0.getTime() + ms);
  const ids = new RecentIds(2, 1000);
  ids.remember("a", t0);
  expect(ids.has("a", later(999))).toBe(true);
  expect(ids.has("a", later(1000))).toBe(false);
  ids.remember("b", later(10));
  ids.remember("c", later(20));
  expect([ids.has("a", later(30)), ids.has("b", later(30)), ids.has("c", later(30))]).toEqual([
    false,
    true,
    true,
  ]);
});
