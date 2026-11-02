import { expect, test } from "bun:test";
import { DAY_MS, MAX_CANDIDATES, type ResolvedOffer } from "@entole/mandate";
import { usd } from "@entole/shared-kernel";
import {
  FakePaymentGateway,
  FakeProductSearch,
  FixedClock,
  InMemoryMandateRepository,
  RecordingLogger,
  ScriptedAgentModel,
  SequentialIds,
} from "@entole/testing";
import { createLimitOrder } from "../../src/index.ts";

const NOW = new Date("2026-10-26T12:00:00Z");

const offer = (productId: string): ResolvedOffer => ({
  productId,
  title: `Shoe ${productId}`,
  merchant: "shop.test",
  brand: "Acme",
  price: usd(18000),
  attributes: { Size: "10" },
  url: `https://shop.test/${productId}`,
  inStock: true,
  condition: "new",
});

const setup = (productIds = ["p1"], createCaps = { perUser: 30, total: 500 }) => {
  const offers = productIds.map(offer);
  const shortlist = JSON.stringify({
    items: productIds.map((id) => ({ product_id: id, merchant: "shop.test", options: {} })),
  });
  const repo = new InMemoryMandateRepository();
  const gateway = new FakePaymentGateway();
  const clock = new FixedClock(NOW);
  const deps = {
    repo,
    gateway,
    clock,
    ids: new SequentialIds(),
    logger: new RecordingLogger(),
    search: new FakeProductSearch(
      offers.map((o) => ({
        productId: o.productId,
        title: o.title,
        offers: [{ merchant: o.merchant, price: o.price }],
        options: {},
        description: "",
      })),
      offers,
    ),
    // One scripted shortlist per create call.
    model: new ScriptedAgentModel(
      Array.from({ length: 5 }, () => ({
        kind: "tools" as const,
        calls: [{ id: "c1", name: "shortlist", argsJson: shortlist }],
      })),
    ),
    createCaps,
    publicBaseUrl: "https://entole.test",
    shippingCallback: false,
  };
  return { deps, repo, gateway, clock };
};

const input = (ownerId = "u1") => ({
  ownerId,
  query: "running shoes",
  requiredAttributes: {},
  brands: [],
  avoid: [],
  limit: usd(15000),
  validDays: 7,
  demoInjection: false,
  replay: false,
});

test("a limit order holds its limit as the budget and runs for the asked days", async () => {
  const { deps, repo } = setup();
  const result = await createLimitOrder(deps, input());
  if (result.outcome !== "created") throw new Error(result.outcome);
  expect(result.approveUrl).toBe("https://paypal.test/approve/order-1");
  expect(result.candidates.map((c) => c.productId)).toEqual(["p1"]);
  const saved = await repo.get(result.id);
  expect(saved?.ownerId).toBe("u1");
  expect(saved?.terms.kind).toBe("limit");
  expect(saved?.terms.maxUnitPrice).toEqual(usd(15000));
  expect(saved?.terms.budget).toEqual(usd(15000));
  expect(saved?.terms.allowedMerchants).toEqual([]);
  expect(saved?.terms.validUntil).toEqual(new Date(NOW.getTime() + 7 * DAY_MS));
});

test("the shortlist keeps at most MAX_CANDIDATES items", async () => {
  const ids = Array.from({ length: MAX_CANDIDATES + 1 }, (_, i) => `p${i + 1}`);
  const { deps } = setup(ids);
  const result = await createLimitOrder(deps, input());
  if (result.outcome !== "created") throw new Error(result.outcome);
  expect(result.candidates).toHaveLength(MAX_CANDIDATES);
});

test("the per-user and the total daily caps refuse before any shortlist or PayPal call", async () => {
  const { deps, gateway, clock } = setup(["p1"], { perUser: 1, total: 2 });
  expect((await createLimitOrder(deps, input("u1"))).outcome).toBe("created");
  expect(await createLimitOrder(deps, input("u1"))).toEqual({ outcome: "daily_limit_reached" });
  expect((await createLimitOrder(deps, input("u2"))).outcome).toBe("created");
  expect(await createLimitOrder(deps, input("u3"))).toEqual({
    outcome: "service_daily_limit_reached",
  });
  expect(gateway.orders).toHaveLength(2);
  clock.advance(DAY_MS + 1);
  expect((await createLimitOrder(deps, input("u3"))).outcome).toBe("created");
});

test("no kept candidate creates nothing and returns the rejections", async () => {
  const { deps, repo, gateway } = setup([]);
  const result = await createLimitOrder(deps, input());
  expect(result.outcome).toBe("no_candidates");
  expect(result).toHaveProperty("rejected");
  expect(await repo.countCreatedSince(new Date(0))).toBe(0);
  expect(gateway.orders).toHaveLength(0);
});
