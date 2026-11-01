import { expect, test } from "bun:test";
import { type Mandate, type MandateStatus, newMandate } from "@entole/mandate";
import { parseUsd } from "@entole/shared-kernel";
import { FixedClock, InMemoryMandateRepository } from "@entole/testing";
import { mandatesToWake, type OfferEvent, recordNotes, recordWakes } from "../../src/index.ts";

const now = new Date("2026-11-01T01:00:00Z");

const limitMandate = (id: string, productId: string, status: MandateStatus): Mandate => ({
  ...newMandate({
    id,
    ownerId: "u1",
    now: new Date("2026-11-01T00:00:00Z"),
    terms: {
      kind: "limit",
      item: { query: "headphones", requiredAttributes: {}, brands: [], avoid: [] },
      candidates: [
        {
          productId,
          merchant: "shop.test",
          options: {},
          title: "Headphones",
          baselinePrice: parseUsd("499.00"),
        },
      ],
      maxUnitPrice: parseUsd("450.00"),
      budget: parseUsd("450.00"),
      allowedMerchants: [],
      validUntil: new Date("2026-11-20T00:00:00Z"),
    },
  }),
  status,
});

const priceDrop: OfferEvent = {
  id: "evt_1",
  kind: "price",
  productId: "p1",
  domain: "shop.test",
  price: parseUsd("439.00"),
  inStock: null,
};

const setup = async () => {
  const repo = new InMemoryMandateRepository();
  await repo.save(limitMandate("m-match", "p1", "funded"));
  await repo.save(limitMandate("m-other", "p2", "funded"));
  await repo.save(limitMandate("m-exhausted", "p1", "exhausted"));
  return { repo, deps: { repo, clock: new FixedClock(now) } };
};

const allAudits = async (repo: InMemoryMandateRepository) =>
  [...(await repo.listAuditFor(["m-match", "m-other", "m-exhausted"])).values()].flat();

test("wakes only funded limit mandates watching the product, writing nothing", async () => {
  const s = await setup();
  expect(await mandatesToWake(s.deps, priceDrop)).toEqual({ wake: ["m-match"], notes: [] });
  expect(await allAudits(s.repo)).toEqual([]);
});

test("wakes nothing when the price is over every limit, noting the watching order", async () => {
  const s = await setup();
  expect(await mandatesToWake(s.deps, { ...priceDrop, price: parseUsd("450.01") })).toEqual({
    wake: [],
    notes: [{ mandateId: "m-match", reason: "above_limit", limit: parseUsd("450.00") }],
  });
});

test("records one timeline entry per woken mandate with the event id", async () => {
  const s = await setup();
  await recordWakes(s.deps, ["m-match"], priceDrop);
  expect(await s.repo.listAudit("m-match")).toEqual([
    {
      at: now,
      kind: "agent_step",
      message: "Channel3 reported a price change at shop.test, checking now",
      data: { eventId: "evt_1", productId: "p1", domain: "shop.test", price: "439.00" },
    },
  ]);
  await recordWakes(s.deps, ["m-match"], {
    ...priceDrop,
    id: "evt_2",
    kind: "availability",
    price: null,
    inStock: true,
  });
  expect((await s.repo.listAudit("m-match"))[1]).toEqual({
    at: now,
    kind: "agent_step",
    message: "Channel3 reported shop.test back in stock, checking now",
    data: { eventId: "evt_2", productId: "p1", domain: "shop.test" },
  });
  expect(await s.repo.listAudit("m-exhausted")).toEqual([]);
});

const priceRise: OfferEvent = {
  ...priceDrop,
  id: "evt_9",
  price: parseUsd("889.99"),
  previousPrice: parseUsd("599.99"),
};

const noteFor = async (s: Awaited<ReturnType<typeof setup>>, e: OfferEvent) => {
  const { notes } = await mandatesToWake(s.deps, e);
  await recordNotes(s.deps, notes, e);
  return s.repo.listAudit("m-match");
};

test("finding wakes and notes reads no audit history", async () => {
  const s = await setup();
  const repo = {
    listFundedLimitForProduct: s.repo.listFundedLimitForProduct.bind(s.repo),
    listAuditFor: () => Promise.reject(new Error("audit read on the wake path")),
    recentNotes: () => Promise.reject(new Error("audit read on the wake path")),
  };
  expect((await mandatesToWake({ repo }, priceRise)).notes).toHaveLength(1);
});

test("records a note with the price, the previous price and the limit", async () => {
  const s = await setup();
  expect(await noteFor(s, priceRise)).toEqual([
    {
      at: now,
      kind: "channel3_noted",
      message:
        "Channel3 reported a price change at shop.test: $889.99 (was $599.99), above your $450.00 limit. Still waiting.",
      data: {
        eventId: "evt_9",
        productId: "p1",
        domain: "shop.test",
        price: "889.99",
        previousPrice: "599.99",
      },
    },
  ]);
  expect(await s.repo.listAudit("m-exhausted")).toEqual([]);
});

test("records not-in-stock and new offer notes with Channel3's availability", async () => {
  const s = await setup();
  const out: OfferEvent = {
    ...priceDrop,
    id: "evt_10",
    kind: "availability",
    price: null,
    inStock: false,
    availability: "OutOfStock",
  };
  expect((await noteFor(s, out)).at(-1)).toEqual({
    at: now,
    kind: "channel3_noted",
    message: "Channel3 reported shop.test is no longer listed as in stock. Still waiting.",
    data: { eventId: "evt_10", productId: "p1", domain: "shop.test", availability: "OutOfStock" },
  });
  const offer: OfferEvent = {
    ...priceRise,
    id: "evt_11",
    kind: "created",
    inStock: true,
    availability: "InStock",
  };
  delete offer.previousPrice;
  expect((await noteFor(s, offer)).at(-1)).toMatchObject({
    message:
      "Channel3 reported a new offer at shop.test: $889.99, above your $450.00 limit. Still waiting.",
    data: { price: "889.99", availability: "InStock" },
  });
});

test("skips a note already recorded for the same product, shop and price within 6 hours", async () => {
  const s = await setup();
  const record = async (e: OfferEvent, deps = s.deps) =>
    recordNotes(deps, (await mandatesToWake(deps, e)).notes, e);
  expect(await record(priceRise)).toEqual(["m-match"]);
  expect(await record({ ...priceRise, id: "evt_12" })).toEqual([]);
  // The shop's case and the previous price do not make it new.
  const again = { ...priceRise, id: "evt_13", domain: "SHOP.test" };
  delete again.previousPrice;
  expect(await record(again)).toEqual([]);
  // Another price is news.
  expect(await record({ ...priceRise, id: "evt_14", price: parseUsd("899.99") })).toEqual([
    "m-match",
  ]);
  // Six hours later the same price is noted again.
  const later = { repo: s.repo, clock: new FixedClock(new Date(now.getTime() + 6 * 3_600_000)) };
  expect(await record({ ...priceRise, id: "evt_15" }, later)).toEqual(["m-match"]);
});

test("writes the notes anyway when the repeat check cannot read", async () => {
  const s = await setup();
  const { notes } = await mandatesToWake(s.deps, priceRise);
  const repo = {
    appendAudit: s.repo.appendAudit.bind(s.repo),
    recentNotes: () => Promise.reject(new Error("db down")),
  };
  const errors = console.error;
  console.error = () => {};
  const written = await recordNotes({ repo, clock: s.deps.clock }, notes, priceRise).finally(() => {
    console.error = errors;
  });
  expect(written).toEqual(["m-match"]);
  expect(await s.repo.listAudit("m-match")).toHaveLength(1);
});
