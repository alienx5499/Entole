import { expect, test } from "bun:test";
import type { MandateTerms, ResolvedOffer } from "@entole/mandate";
import { usd } from "@entole/shared-kernel";
import { FakeProductSearch, FixedClock, must, ScriptedAgentModel } from "@entole/testing";
import { shortlistCandidates } from "../../src/index.ts";

const TRAP = {
  productId: "demo-trap-1",
  merchant: "deals-unlimited.example",
  options: { Size: "11" },
};

const offer = (productId: string, merchant: string, cents: number): ResolvedOffer => ({
  productId,
  title: `Shoe ${productId}`,
  merchant,
  brand: "",
  price: usd(cents),
  attributes: { Size: "10" },
  url: `https://${merchant}/${productId}`,
});
const summary = (o: ResolvedOffer) => ({
  productId: o.productId,
  title: o.title,
  offers: [{ merchant: o.merchant, price: o.price }],
  options: { Size: ["9", "10"] },
  description: "",
});
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

const call = (name: string, args: unknown) => ({ id: name, name, argsJson: JSON.stringify(args) });

test("shortlist with injection keeps the 2 valid items, deduped, and rejects the trap", async () => {
  const model = new ScriptedAgentModel([
    { kind: "tools", calls: [call("search_products", { query: "running shoes" })] },
    {
      kind: "tools",
      calls: [
        call("shortlist", {
          items: [
            { product_id: TRAP.productId, merchant: TRAP.merchant, options: TRAP.options },
            { product_id: "p1", merchant: "shop.test", options: { Size: "10" } },
            { product_id: "p1", merchant: "SHOP.test", options: { " size ": "10 " } },
            { product_id: "p2", merchant: "run.test", options: { Size: "10" } },
          ],
        }),
      ],
    },
  ]);
  const clock = new FixedClock(new Date("2026-10-26T00:00:00Z"));
  const { kept, rejected } = await shortlistCandidates(
    { model, search: liveSearch(), clock },
    { terms: baseTerms(), demoInjection: true, max: 3 },
  );
  expect(kept.map((c) => c.productId)).toEqual(["p1", "p2"]);
  expect(kept.map((c) => c.baselinePrice.cents)).toEqual([24900, 21000]);
  expect(rejected).toHaveLength(1);
  const trap = must(rejected[0], "rejected trap");
  expect(trap.merchant).toBe(TRAP.merchant);
  expect(trap.details.join(" ")).toMatch(/not|price/i);
  // The search tool result the model saw carried the labelled trap listing.
  expect(must(model.seen[1], "second turn").messages.at(-1)?.content).toContain(TRAP.productId);
});

test("shortlist falls back to top search results that pass the pre-check", async () => {
  const model = new ScriptedAgentModel([{ kind: "final", text: "no idea" }]);
  const { kept, rejected } = await shortlistCandidates(
    { model, search: liveSearch(), clock: new FixedClock(new Date("2026-10-26T00:00:00Z")) },
    { terms: baseTerms(), demoInjection: true, max: 3 },
  );
  expect(kept.map((c) => [c.productId, c.options.Size])).toEqual([
    ["p1", "10"],
    ["p2", "10"],
  ]);
  expect(rejected.map((r) => r.merchant)).toEqual([TRAP.merchant]);
});

test("the planted listing is never signable, even when the form has no size and no brand", async () => {
  // No required attribute, no brand, any merchant: only the limit price could have stopped the trap,
  // and a limit shortlist ignores today's price.
  const terms: Omit<MandateTerms, "candidates"> = {
    ...baseTerms(),
    item: { query: "running shoes", requiredAttributes: {}, brands: [], avoid: [] },
  };
  const model = new ScriptedAgentModel([
    {
      kind: "tools",
      calls: [
        call("shortlist", {
          items: [{ product_id: TRAP.productId, merchant: TRAP.merchant, options: TRAP.options }],
        }),
      ],
    },
  ]);
  const { kept, rejected } = await shortlistCandidates(
    { model, search: liveSearch(), clock: new FixedClock(new Date("2026-10-26T00:00:00Z")) },
    { terms, demoInjection: true, max: 3 },
  );
  expect(kept.map((c) => c.productId)).not.toContain(TRAP.productId);
  // The fallback search tops up with the real listings; the trap stays out.
  expect(kept.map((c) => c.productId)).toEqual(["p1", "p2"]);
  expect(rejected).toEqual([
    {
      title: "Running Shoe Pro Max (Size 11)",
      merchant: TRAP.merchant,
      details: ["Planted demo listing, never signable"],
    },
  ]);
});

// Live offers resolve after a per-product delay, so a later item can finish first.
class DelayedSearch extends FakeProductSearch {
  calls: string[] = [];
  inFlight = 0;
  maxInFlight = 0;
  constructor(
    offers: ResolvedOffer[],
    private readonly delayMs: Record<string, number>,
    private readonly failing = new Set<string>(),
  ) {
    super(offers.map(summary), offers);
  }
  override async resolveOffer(i: Parameters<FakeProductSearch["resolveOffer"]>[0]) {
    this.calls.push(i.productId);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((r) => setTimeout(r, this.delayMs[i.productId] ?? 0));
    this.inFlight--;
    if (this.failing.has(i.productId)) throw new Error(`catalog down for ${i.productId}`);
    return super.resolveOffer(i);
  }
}

const pick = (...ids: string[]) =>
  new ScriptedAgentModel([
    {
      kind: "tools",
      calls: [
        call("shortlist", {
          items: ids.map((id) => ({
            product_id: id,
            merchant: id === "gone" ? "nowhere.test" : "shop.test",
            options: { Size: "10" },
          })),
        }),
      ],
    },
  ]);
const five = ["p1", "p2", "p3", "p4", "p5"].map((id) => offer(id, "shop.test", 20000));
const clock = () => new FixedClock(new Date("2026-10-26T00:00:00Z"));

test("kept and rejected follow the model's order even when later offers resolve first", async () => {
  const search = new DelayedSearch(five, { p1: 30, gone: 20, p2: 10, p3: 0 });
  const { kept, rejected } = await shortlistCandidates(
    { model: pick("p1", "gone", "p2", "p3"), search, clock: clock() },
    { terms: baseTerms(), demoInjection: false, max: 3 },
  );
  expect(kept.map((c) => c.productId)).toEqual(["p1", "p2", "p3"]);
  expect(rejected.map((r) => r.title)).toEqual(["gone"]);
  expect(search.maxInFlight).toBeGreaterThan(1);
});

test("duplicates resolve once and the max cap keeps the first 3 unique items", async () => {
  const search = new DelayedSearch(five, { p1: 20, p4: 0 });
  const { kept, rejected } = await shortlistCandidates(
    { model: pick("p1", "p1", "p2", "gone", "p2", "p3", "p4", "p5"), search, clock: clock() },
    { terms: baseTerms(), demoInjection: false, max: 3 },
  );
  expect(kept.map((c) => c.productId)).toEqual(["p1", "p2", "p3"]);
  expect(rejected.map((r) => r.title)).toEqual(["gone"]);
  expect(search.calls.filter((id) => id === "p1")).toHaveLength(1);
});

test("a catalog failure past the cap is ignored; one before the cap still fails the call", async () => {
  const pastCap = new DelayedSearch(five, {}, new Set(["p4"]));
  const { kept } = await shortlistCandidates(
    { model: pick("p1", "p2", "p3", "p4"), search: pastCap, clock: clock() },
    { terms: baseTerms(), demoInjection: false, max: 3 },
  );
  expect(kept.map((c) => c.productId)).toEqual(["p1", "p2", "p3"]);

  const beforeCap = new DelayedSearch(five, {}, new Set(["p2"]));
  await expect(
    shortlistCandidates(
      { model: pick("p1", "p2", "p3"), search: beforeCap, clock: clock() },
      { terms: baseTerms(), demoInjection: false, max: 3 },
    ),
  ).rejects.toThrow("catalog down for p2");
});

test("the fallback resolves its listings together and keeps search order", async () => {
  const search = new DelayedSearch(five, { p1: 30, p2: 20, p3: 10 });
  const { kept } = await shortlistCandidates(
    { model: new ScriptedAgentModel([{ kind: "final", text: "no idea" }]), search, clock: clock() },
    { terms: baseTerms(), demoInjection: false, max: 3 },
  );
  expect(kept.map((c) => c.productId)).toEqual(["p1", "p2", "p3"]);
  expect(search.maxInFlight).toBeGreaterThan(1);
});

test("an offer far below its peers' median is rejected with the usual price", async () => {
  const cheap = offer("p1", "cheap.test", 4900);
  const listing = {
    ...summary(cheap),
    offers: [
      { merchant: "cheap.test", price: usd(4900) },
      { merchant: "a.test", price: usd(17000) },
      { merchant: "b.test", price: usd(19000) },
    ],
  };
  const { kept, rejected } = await shortlistCandidates(
    {
      model: new ScriptedAgentModel([{ kind: "final", text: "" }]),
      search: new FakeProductSearch([listing], [cheap]),
      clock: clock(),
    },
    { terms: baseTerms(), demoInjection: false, max: 3 },
  );
  expect(kept).toEqual([]);
  expect(rejected.map((r) => r.details)).toEqual([
    ["$49.00 is far below the usual $180.00 for this product"],
  ]);
});

test("a normal spread, or fewer than 2 peers, is not judged an outlier", async () => {
  const o = offer("p1", "cheap.test", 9000);
  const spread = {
    ...summary(o),
    offers: ["a.test", "b.test"].map((m) => ({ merchant: m, price: usd(17000) })),
  };
  const run = (offers: { merchant: string; price: ReturnType<typeof usd> }[]) =>
    shortlistCandidates(
      {
        model: new ScriptedAgentModel([{ kind: "final", text: "" }]),
        search: new FakeProductSearch([{ ...spread, offers }], [o]),
        clock: clock(),
      },
      { terms: baseTerms(), demoInjection: false, max: 3 },
    );
  const own = { merchant: "cheap.test", price: usd(9000) };
  expect((await run([own, ...spread.offers])).kept).toHaveLength(1);
  expect((await run([own, spread.offers[0] as (typeof spread.offers)[0]])).kept).toHaveLength(1);
});

const listing = (offers: ResolvedOffer[]) => ({
  ...summary(must(offers[0], "first offer")),
  offers: offers.map((o) => ({ merchant: o.merchant, price: o.price })),
});

test("a kept product signs its other shops that pass the same checks, outlier rule per shop", async () => {
  const shops = [
    offer("p1", "shop.test", 24900),
    offer("p1", "b.test", 23000),
    offer("p1", "c.test", 9000), // under half the other shops' usual price
    { ...offer("p1", "d.test", 24000), attributes: { Size: "11" } },
  ];
  // e.test is listed but has no live offer.
  const p1 = listing(shops);
  p1.offers.push({ merchant: "e.test", price: usd(22000) });
  const model = new ScriptedAgentModel([{ kind: "final", text: "no idea" }]);
  const { kept } = await shortlistCandidates(
    {
      model,
      search: new FakeProductSearch([p1], shops),
      clock: new FixedClock(new Date("2026-10-26T00:00:00Z")),
    },
    { terms: baseTerms(), demoInjection: false, max: 3 },
  );
  expect(kept.map((c) => [c.merchant, c.merchants])).toEqual([
    ["shop.test", ["shop.test", "b.test"]],
  ]);
});

test("a kept product signs at most 5 shops, the cheapest listed first", async () => {
  const shops = [24900, 24000, 23000, 22000, 21000, 20000, 19000].map((cents, k) =>
    offer("p1", `s${k}.test`, cents),
  );
  const model = new ScriptedAgentModel([{ kind: "final", text: "no idea" }]);
  const { kept } = await shortlistCandidates(
    {
      model,
      search: new FakeProductSearch([listing(shops)], shops),
      clock: new FixedClock(new Date("2026-10-26T00:00:00Z")),
    },
    { terms: baseTerms(), demoInjection: false, max: 3 },
  );
  expect(must(kept[0], "kept").merchants).toEqual([
    "s0.test",
    "s6.test",
    "s5.test",
    "s4.test",
    "s3.test",
  ]);
});
