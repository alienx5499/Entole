import { expect, test } from "bun:test";
import { createMandate, fundMandate } from "@entole/mandate";
import { usd } from "@entole/shared-kernel";
import {
  FakePaymentGateway,
  FakeProductSearch,
  FixedClock,
  InMemoryMandateRepository,
  must,
  SequentialIds,
} from "@entole/testing";
import { runWatcherTick } from "../../src/index.ts";
import { offer, summary } from "./counting-search.ts";

const DAY = 24 * 3600 * 1000;

// Price stays above the $80 limit, so the watcher only renews, closes or waits.
const setup = async (validUntil: Date) => {
  const repo = new InMemoryMandateRepository();
  const gateway = new FakePaymentGateway();
  gateway.authorizationExpiresAt = new Date("2026-11-26T00:00:00Z"); // 29 days after approval
  const clock = new FixedClock(new Date("2026-10-28T00:00:00Z"));
  const live = [offer("p1", "shop.test", 9000)];
  const search = new FakeProductSearch(live.map(summary), live);
  const deps = { repo, gateway, clock, ids: new SequentialIds(), search, prices: search };
  const { mandate } = await createMandate(deps, {
    ownerId: "u1",
    terms: {
      kind: "limit",
      candidates: [
        {
          productId: "p1",
          merchant: "shop.test",
          options: {},
          title: "Shoe",
          baselinePrice: usd(9000),
        },
      ],
      item: { query: "shoes", requiredAttributes: {}, brands: [], avoid: [] },
      maxUnitPrice: usd(8000),
      budget: usd(8000),
      allowedMerchants: [],
      validUntil,
    },
    demoInjection: false,
    baseUrl: "https://entole.test",
  });
  await fundMandate(deps, { mandateId: mandate.id, orderId: "order-1" });
  return { deps, repo, gateway, clock, id: mandate.id };
};

test("watcher renews the hold after the honor period and keeps watching", async () => {
  const s = await setup(new Date("2026-11-20T00:00:00Z"));
  s.clock.advance(DAY);
  expect(await runWatcherTick(s.deps, {})).toEqual({ checked: 1, captured: [], closed: [] });
  expect(s.gateway.reauthorizations).toHaveLength(0);
  s.clock.advance(3 * DAY);
  expect(await runWatcherTick(s.deps, {})).toEqual({ checked: 1, captured: [], closed: [] });
  expect(s.gateway.reauthorizations).toHaveLength(1);
  const m = must(await s.repo.get(s.id), "mandate");
  expect(m.status).toBe("funded");
  expect(m.authorization?.id).toBe("reauth-auth-order-1");
  // A cheaper price later is captured on the renewed hold.
  s.deps.prices = new FakeProductSearch([], [offer("p1", "shop.test", 7500)]);
  s.clock.advance(DAY);
  const tick = await runWatcherTick(s.deps, {});
  expect(tick.captured).toEqual([s.id]);
  expect(s.gateway.captures.map((c) => c.authorizationId)).toEqual(["reauth-auth-order-1"]);
});

test("a denied renewal closes the mandate cleanly and voids the old hold", async () => {
  const s = await setup(new Date("2026-11-20T00:00:00Z"));
  s.gateway.nextReauthorize = "denied";
  s.clock.advance(4 * DAY);
  expect(await runWatcherTick(s.deps, {})).toEqual({ checked: 1, captured: [], closed: [s.id] });
  const m = must(await s.repo.get(s.id), "mandate");
  expect(m.status).toBe("closed");
  expect(s.gateway.voids).toEqual(["auth-order-1"]);
  expect(s.gateway.captures).toHaveLength(0);
});

test("past the 29-day hold the watcher closes without renewing", async () => {
  const s = await setup(new Date("2026-11-26T00:00:00Z"));
  s.clock.advance(29 * DAY);
  expect(await runWatcherTick(s.deps, {})).toEqual({ checked: 1, captured: [], closed: [s.id] });
  expect(s.gateway.reauthorizations).toHaveLength(0);
});

test("a transient renewal failure is audited and retried on the next tick", async () => {
  const s = await setup(new Date("2026-11-20T00:00:00Z"));
  s.gateway.nextReauthorize = "error";
  s.clock.advance(4 * DAY);
  expect(await runWatcherTick(s.deps, {})).toEqual({ checked: 1, captured: [], closed: [] });
  expect((await s.repo.listAudit(s.id)).at(-1)?.message).toContain("will retry");
  await runWatcherTick(s.deps, {});
  expect(s.gateway.reauthorizations).toHaveLength(1);
});
