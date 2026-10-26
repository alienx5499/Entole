import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import { FixedClock } from "@entole/testing";
import { withReplayPrices } from "../../src/index.ts";
import { CountingSearch, offer } from "./counting-search.ts";

const three = [
  offer("p1", "shop.test", 24900),
  offer("p2", "run.test", 15900),
  offer("p3", "go.test", 16000),
];
const asked = three.map((o) => ({
  productId: o.productId,
  merchant: o.merchant,
  options: { Size: "10" },
}));

test("replay calls the live resolveOffer once per candidate across 30 ticks", async () => {
  const search = new CountingSearch(three);
  const clock = new FixedClock(new Date("2026-10-26T00:00:00Z"));
  const prices = withReplayPrices(search, [24900, 19900, 15900].map(usd), clock.now(), clock);
  const seen: number[] = [];
  for (let tick = 0; tick < 30; tick++) {
    for (const c of asked) seen.push((await prices.resolveOffer(c))?.price.cents ?? 0);
    clock.advance(2000);
  }
  expect(search.calls).toEqual(["p1", "p2", "p3"]);
  // The price still moves per tick; only the live lookup is shared.
  expect(seen.slice(0, 9)).toEqual([24900, 24900, 24900, 19900, 19900, 19900, 15900, 15900, 15900]);
});

test("replay shares one live call between concurrent lookups of the same candidate", async () => {
  const search = new CountingSearch(three, { p1: 10 });
  const clock = new FixedClock(new Date("2026-10-26T00:00:00Z"));
  const prices = withReplayPrices(search, [usd(15900)], clock.now(), clock);
  const req = { productId: "p1", merchant: "shop.test", options: { Size: "10" } };
  const same = { productId: "p1", merchant: " SHOP.test", options: { " size ": "10 " } };
  const offers = await Promise.all([req, req, same, req].map((r) => prices.resolveOffer(r)));
  expect(offers.map((o) => o?.price.cents)).toEqual([15900, 15900, 15900, 15900]);
  expect(search.calls).toEqual(["p1"]);
});

test("replay does not cache a failed live call", async () => {
  const search = new CountingSearch(three);
  search.failNext = 1;
  const clock = new FixedClock(new Date("2026-10-26T00:00:00Z"));
  const prices = withReplayPrices(search, [usd(15900)], clock.now(), clock);
  const req = { productId: "p1", merchant: "shop.test", options: {} };
  await expect(prices.resolveOffer(req)).rejects.toThrow("catalog down");
  expect((await prices.resolveOffer(req))?.price.cents).toBe(15900);
  expect((await prices.resolveOffer(req))?.price.cents).toBe(15900);
  expect(search.calls).toEqual(["p1", "p1"]);
});
