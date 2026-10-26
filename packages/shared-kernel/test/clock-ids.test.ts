import { expect, test } from "bun:test";
import { SystemClock } from "../src/clock.ts";
import { CryptoIds } from "../src/ids.ts";

test("CryptoIds keeps the prefix and never repeats", () => {
  const ids = new CryptoIds();
  const a = ids.next("mandate");
  expect(a.startsWith("mandate_")).toBe(true);
  expect(ids.next("mandate")).not.toBe(a);
});

test("SystemClock returns the current time", () => {
  const before = Date.now();
  expect(new SystemClock().now().getTime()).toBeGreaterThanOrEqual(before);
});
