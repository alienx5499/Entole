import { expect, test } from "bun:test";
import {
  type Candidate,
  createMandate,
  fundMandate,
  type MandateTerms,
  type ProductSearch,
  proposeOrder,
  type ResolvedOffer,
} from "@entole/mandate";
import { usd } from "@entole/shared-kernel";
import { withDemoInjection } from "@entole/shopping";
import {
  FakePaymentGateway,
  FakePriceTracker,
  FakeProductSearch,
  FixedClock,
  InMemoryMandateRepository,
  must,
  SequentialIds,
} from "@entole/testing";
import {
  runWatcherTick,
  savingsFor,
  startLimitTracking,
  withReplayPrices,
} from "../../src/index.ts";
import { CountingSearch, offer, summary } from "./counting-search.ts";

const TRAP = {
  productId: "demo-trap-1",
  merchant: "deals-unlimited.example",
  options: { Size: "11" },
};

const live = [offer("p1", "shop.test", 24900), offer("p2", "run.test", 21000)];
const liveSearch = () => new FakeProductSearch(live.map(summary), live);

const baseTerms = (): Omit<MandateTerms, "candidates"> => ({
  kind: "limit",
  item: { query: "running shoes", requiredAttributes: { Size: "10" }, brands: [], avoid: [] },
  maxUnitPrice: usd(17000),
  budget: usd(17000),
  allowedMerchants: [],
  validUntil: new Date("2026-10-28T00:00:00Z"),
});
const candidates: Candidate[] = [
  {
    productId: "p1",
    merchant: "shop.test",
    options: { Size: "10" },
    title: "Shoe p1",
    baselinePrice: usd(24900),
  },
  {
    productId: "p2",
    merchant: "run.test",
    options: { Size: "10" },
    title: "Shoe p2",
    baselinePrice: usd(21000),
  },
];

// Tracking starts after funding returns, without blocking it; let it finish.
const flush = () => new Promise((r) => setTimeout(r, 0));

const setup = async (search: ProductSearch = liveSearch(), cands: Candidate[] = candidates) => {
  const repo = new InMemoryMandateRepository();
  const gateway = new FakePaymentGateway();
  const clock = new FixedClock(new Date("2026-10-26T00:00:00Z"));
  const tracker = new FakePriceTracker();
  const deps = {
    repo,
    gateway,
    clock,
    ids: new SequentialIds(),
    tracker,
    search,
  };
  const { mandate } = await createMandate(deps, {
    ownerId: "u1",
    terms: { ...baseTerms(), candidates: cands },
    demoInjection: false,
    baseUrl: "https://entole.test",
  });
  // The API runs tracking right after funding, without awaiting it.
  const fund = async () => {
    const funded = await fundMandate(deps, { mandateId: mandate.id, orderId: "order-1" });
    void startLimitTracking(deps, funded);
    return funded;
  };
  return { deps, repo, gateway, clock, tracker, id: mandate.id, fund };
};

test("limit flow: tracking starts per candidate, watcher buys at $159 on replay, voids, saves $90", async () => {
  const s = await setup();
  await s.fund();
  await flush();
  expect(s.tracker.started).toEqual(["p1", "p2"]);
  const prices = withReplayPrices(
    s.deps.search,
    [24900, 19900, 15900].map(usd),
    s.clock.now(),
    s.clock,
  );
  const deps = { ...s.deps, prices };

  expect(await runWatcherTick(deps, {})).toEqual({ checked: 1, captured: [], closed: [] });
  expect(s.gateway.captures).toHaveLength(0);

  s.clock.advance(4000);
  expect(await runWatcherTick(deps, {})).toEqual({
    checked: 1,
    captured: [s.id],
    closed: [s.id],
  });
  expect(s.gateway.captures.map((c) => c.amount.cents)).toEqual([15900]);
  // A limit mandate captures once, so its PayPal-Request-Id is stable across retries.
  expect(s.gateway.captures.map((c) => c.idempotencyKey)).toEqual([`${s.id}-capture`]);
  expect(s.gateway.voids).toHaveLength(1);
  const m = must(await s.repo.get(s.id), "mandate");
  expect(m.status).toBe("closed");
  expect(savingsFor(usd(15900), must(m.terms.candidates[0], "candidate").baselinePrice).cents).toBe(
    9000,
  );
  const allowed = (await s.repo.listAudit(s.id)).find((e) => e.kind === "proposal_allowed");
  expect(allowed?.data?.source).toBe("watcher");

  expect(await runWatcherTick(deps, {})).toEqual({ checked: 0, captured: [], closed: [] });
  expect(s.gateway.voids).toHaveLength(1);
});

test("watcher closes an exhausted limit mandate whose void failed on the previous tick", async () => {
  const s = await setup();
  await s.fund();
  const prices = withReplayPrices(s.deps.search, [usd(15900)], s.clock.now(), s.clock);
  s.gateway.failNextVoid();
  expect(await runWatcherTick({ ...s.deps, prices }, {})).toEqual({
    checked: 1,
    captured: [s.id],
    closed: [],
  });
  expect((await s.repo.get(s.id))?.status).toBe("exhausted");
  await runWatcherTick({ ...s.deps, prices }, {});
  expect((await s.repo.get(s.id))?.status).toBe("closed");
  expect(s.gateway.captures).toHaveLength(1);
  expect(s.gateway.voids).toHaveLength(1);
});

test("a void that keeps failing is retried 3 times, audited once, then left alone", async () => {
  const s = await setup();
  await s.fund();
  const prices = withReplayPrices(s.deps.search, [usd(15900)], s.clock.now(), s.clock);
  for (let i = 0; i < 5; i++) s.gateway.failNextVoid();
  for (let i = 0; i < 5; i++) await runWatcherTick({ ...s.deps, prices }, {});
  const m = must(await s.repo.get(s.id), "mandate");
  expect(m.status).toBe("exhausted");
  expect(m.voidAttempts).toBe(3);
  const audit = await s.repo.listAudit(s.id);
  expect(audit.filter((e) => e.message === "Release failed; contact support")).toHaveLength(1);
  // ticks 1 and 2 retry; tick 3 gives up; ticks 4 and 5 skip the mandate entirely
  expect(audit.filter((e) => e.message.startsWith("Watcher check failed"))).toHaveLength(2);
  expect(await runWatcherTick({ ...s.deps, prices }, { mandateId: s.id })).toEqual({
    checked: 0,
    captured: [],
    closed: [],
  });
  expect(s.gateway.captures).toHaveLength(1);
});

test("watcher closes and voids an expired limit mandate", async () => {
  const s = await setup();
  await s.fund();
  s.clock.advance(3 * 24 * 3600 * 1000);
  const r = await runWatcherTick({ ...s.deps, prices: s.deps.search }, { mandateId: s.id });
  expect(r).toEqual({ checked: 1, captured: [], closed: [s.id] });
  expect((await s.repo.get(s.id))?.status).toBe("closed");
  expect(s.gateway.voids).toHaveLength(1);
  expect(s.gateway.captures).toHaveLength(0);
});

test("proposing the trap on a limit mandate is blocked with not_a_candidate", async () => {
  const s = await setup();
  await s.fund();
  const { verdict } = await proposeOrder(
    { ...s.deps, search: withDemoInjection(s.deps.search) },
    { mandateId: s.id, ...TRAP, source: "simulated" },
  );
  expect(verdict.kind).toBe("block");
  if (verdict.kind === "block") expect(verdict.reasons).toContain("not_a_candidate");
  expect(s.gateway.captures).toHaveLength(0);
});

test("a price tracking failure is audited and funding still succeeds", async () => {
  const s = await setup();
  s.tracker.failStarts = true;
  expect((await s.fund()).status).toBe("funded");
  await flush();
  const steps = (await s.repo.listAudit(s.id)).filter((e) => e.kind === "agent_step");
  expect(steps).toHaveLength(2);
  expect(steps.every((e) => e.message.includes("failed"))).toBe(true);
});

test("replay swaps only the price and returns null when the live offer is gone", async () => {
  const clock = new FixedClock(new Date("2026-10-26T00:00:00Z"));
  const prices = withReplayPrices(liveSearch(), [usd(100), usd(200)], clock.now(), clock);
  const req = { productId: "p1", merchant: "shop.test", options: {} };
  expect(await prices.resolveOffer(req)).toEqual({
    ...offer("p1", "shop.test", 24900),
    price: usd(100),
  });
  clock.advance(60_000);
  expect((await prices.resolveOffer(req))?.price.cents).toBe(200);
  expect(await prices.resolveOffer({ ...req, productId: "gone" })).toBeNull();
});

const cand = (o: ResolvedOffer): Candidate => ({
  productId: o.productId,
  merchant: o.merchant,
  options: { Size: "10" },
  title: o.title,
  baselinePrice: usd(24900),
});
// p1 is over the $170 limit; p2 and p3 are under it, and p3 answers first.
const three = [
  offer("p1", "shop.test", 24900),
  offer("p2", "run.test", 15900),
  offer("p3", "go.test", 16000),
];

test("watcher resolves candidates together and buys the cheapest eligible one", async () => {
  const search = new CountingSearch(three, { p1: 30, p2: 20, p3: 0 });
  const s = await setup(search, three.map(cand));
  await s.fund();
  expect(await runWatcherTick({ ...s.deps, prices: search }, {})).toEqual({
    checked: 1,
    captured: [s.id],
    closed: [s.id],
  });
  expect(search.maxInFlight).toBeGreaterThan(1);
  expect(s.gateway.captures.map((c) => c.amount.cents)).toEqual([15900]);
  const proposals = (await s.repo.listAudit(s.id)).filter((e) => e.kind.startsWith("proposal_"));
  // One proposal after the buy-side compare: p2 is bought, p3 is never proposed.
  expect(proposals.map((e) => e.kind)).toEqual(["proposal_allowed"]);
  expect(proposals[0]?.data?.productId).toBe("p2");
});

test("watcher stops at the first allowed proposal even when every candidate is eligible", async () => {
  const cheap = three.map((o) => ({ ...o, price: usd(15000) }));
  const search = new CountingSearch(cheap, { p1: 20 });
  const s = await setup(search, cheap.map(cand));
  await s.fund();
  await runWatcherTick({ ...s.deps, prices: search }, {});
  expect(s.gateway.captures).toHaveLength(1);
  expect(s.gateway.captures[0]?.amount.cents).toBe(15000);
  const allowed = (await s.repo.listAudit(s.id)).filter((e) => e.kind === "proposal_allowed");
  expect(allowed).toHaveLength(1);
  expect((await s.repo.get(s.id))?.status).toBe("closed");
});

test("watcher buys from the cheapest signed shop that passes, skipping a failing and a sold-out shop", async () => {
  const shops = [
    offer("p1", "shop.test", 24900), // over the limit
    { ...offer("p1", "a.test", 15000), attributes: { Size: "11" } }, // cheapest, wrong size
    offer("p1", "c.test", 16500),
    offer("p1", "d.test", 16000),
    // b.test is signed but sold out: no live offer
  ];
  const search = new CountingSearch(shops);
  const signed = {
    ...cand(must(shops[0], "p1")),
    merchants: ["shop.test", "a.test", "b.test", "c.test", "d.test"],
  };
  const s = await setup(search, [signed]);
  await s.fund();
  expect(await runWatcherTick({ ...s.deps, prices: search }, {})).toEqual({
    checked: 1,
    captured: [s.id],
    closed: [s.id],
  });
  expect(s.gateway.captures.map((c) => c.amount.cents)).toEqual([16000]);
  const proposals = (await s.repo.listAudit(s.id)).filter((e) => e.kind.startsWith("proposal_"));
  expect(proposals.map((e) => [e.kind, e.data?.merchant])).toEqual([
    ["proposal_blocked", "a.test"],
    ["proposal_allowed", "d.test"],
  ]);
  expect(proposals[1]?.data?.shopsCompared).toBe("4");
  expect(proposals[1]?.message).toContain("from d.test, the cheapest of 4 shops compared");
});

test("a shop blocked for the same reason on every tick is logged once", async () => {
  const shops = [
    offer("p1", "shop.test", 24900), // over the limit
    { ...offer("p1", "a.test", 15000), attributes: { Size: "11" } }, // affordable, wrong size
  ];
  const search = new CountingSearch(shops);
  const s = await setup(search, [
    { ...cand(must(shops[0], "p1")), merchants: ["shop.test", "a.test"] },
  ]);
  await s.fund();
  for (let i = 0; i < 3; i++) await runWatcherTick({ ...s.deps, prices: search }, {});
  const blocked = (await s.repo.listAudit(s.id)).filter((e) => e.kind === "proposal_blocked");
  expect(blocked).toHaveLength(1);
  expect(s.gateway.captures).toHaveLength(0);
});

test("watcher quotes every signed shop a few at a time", async () => {
  const merchants = ["s1.test", "s2.test", "s3.test", "s4.test", "s5.test"];
  const all = ["p1", "p2", "p3"].flatMap((p) => merchants.map((m) => offer(p, m, 24900)));
  const search = new CountingSearch(all, { p1: 5, p2: 5, p3: 5 });
  const cands = ["p1", "p2", "p3"].map((p) => ({ ...cand(offer(p, "s1.test", 24900)), merchants }));
  const s = await setup(search, cands);
  await s.fund();
  await runWatcherTick({ ...s.deps, prices: search }, {});
  expect(search.calls).toHaveLength(15);
  expect(search.maxInFlight).toBe(5);
  expect(s.gateway.captures).toHaveLength(0);
});

test("replay gives every shop of a product the recorded price; the tie goes to the shortlisted shop", async () => {
  const shops = [offer("p1", "shop.test", 24900), offer("p1", "b.test", 23000)];
  const search = new FakeProductSearch(shops.map(summary), shops);
  const s = await setup(search, [
    { ...cand(must(shops[0], "p1")), merchants: ["shop.test", "b.test"] },
  ]);
  await s.fund();
  const prices = withReplayPrices(search, [usd(15900)], s.clock.now(), s.clock);
  await runWatcherTick({ ...s.deps, prices }, {});
  const allowed = (await s.repo.listAudit(s.id)).find((e) => e.kind === "proposal_allowed");
  expect(allowed?.data?.merchant).toBe("shop.test");
  expect(s.gateway.captures.map((c) => c.amount.cents)).toEqual([15900]);
});

test("a failed shop quote is skipped; the tick fails only when every quote fails", async () => {
  const shops = [offer("p1", "shop.test", 15900), offer("p1", "b.test", 15000)];
  const search = new CountingSearch(shops);
  const s = await setup(search, [
    { ...cand(must(shops[0], "p1")), merchants: ["shop.test", "b.test"] },
  ]);
  await s.fund();
  search.failNext = 2;
  expect(await runWatcherTick({ ...s.deps, prices: search }, {})).toEqual({
    checked: 1,
    captured: [],
    closed: [],
  });
  const audit = await s.repo.listAudit(s.id);
  expect(audit.some((e) => e.message.startsWith("Watcher check failed"))).toBe(true);
  search.failNext = 1; // shop.test fails, b.test answers
  await runWatcherTick({ ...s.deps, prices: search }, {});
  expect(s.gateway.captures.map((c) => c.amount.cents)).toEqual([15000]);
});
