import { expect, test } from "bun:test";
import { usd, usdFromDollars } from "@entole/shared-kernel";
import { priceStats } from "../../src/index.ts";

const at = (day: string, dollars: number) => ({
  at: new Date(`${day}T00:00:00Z`),
  price: usdFromDollars(dollars),
});

test("no history gives no stats", () => {
  expect(priceStats([])).toBeNull();
});

test("a single point is the low, the high and the current price", () => {
  expect(priceStats([at("2026-10-20", 99.5)])).toEqual({
    low: usd(9950),
    high: usd(9950),
    current: usd(9950),
    aboveLowPercent: 0,
  });
});

test("equal prices sit at the low", () => {
  const s = priceStats([at("2026-10-29", 20), at("2026-10-30", 20)]);
  expect(s).toMatchObject({ low: usd(2000), high: usd(2000), aboveLowPercent: 0 });
});

test("low, high and the latest price, in any input order", () => {
  const s = priceStats([
    at("2026-10-31", 380),
    at("2026-10-05", 449.99),
    at("2026-10-20", 326.99),
    at("2026-11-01", 366.24),
  ]);
  expect(s).toEqual({
    low: usd(32699),
    high: usd(44999),
    current: usd(36624),
    aboveLowPercent: 12, // 39.25 / 326.99 = 12.0%
  });
});

test("float dollars round to cents and the percent to a whole number", () => {
  const s = priceStats([at("2026-10-01", 2.999), at("2026-10-02", 3.333)]);
  expect(s).toMatchObject({ low: usd(300), current: usd(333), aboveLowPercent: 11 });
});

test("a $0 low gives no percent instead of Infinity", () => {
  const s = priceStats([at("2026-10-01", 0), at("2026-10-02", 5)]);
  expect(s).toMatchObject({ low: usd(0), current: usd(500), aboveLowPercent: null });
});
