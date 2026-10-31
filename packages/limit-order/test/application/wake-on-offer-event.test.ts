import { expect, test } from "bun:test";
import { type Mandate, type MandateStatus, newMandate } from "@entole/mandate";
import { parseUsd } from "@entole/shared-kernel";
import { FixedClock, InMemoryMandateRepository } from "@entole/testing";
import { mandatesToWake, type OfferEvent, recordWakes } from "../../src/index.ts";

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
  expect(await mandatesToWake(s.deps, priceDrop)).toEqual(["m-match"]);
  expect(await allAudits(s.repo)).toEqual([]);
});

test("wakes nothing when the price is over every limit", async () => {
  const s = await setup();
  expect(await mandatesToWake(s.deps, { ...priceDrop, price: parseUsd("450.01") })).toEqual([]);
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
