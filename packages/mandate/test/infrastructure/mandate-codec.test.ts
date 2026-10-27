import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import { must } from "@entole/testing";
import {
  mandateDigest,
  mandateFromJson,
  mandateToJson,
  newMandate,
  shopsOf,
} from "../../src/index.ts";

const now = new Date("2026-10-26T10:00:00.000Z");
const base = newMandate({
  id: "m1",
  ownerId: "u1",
  now,
  terms: {
    kind: "limit",
    item: { query: "running shoes", requiredAttributes: { Size: "10" }, brands: ["On"], avoid: [] },
    candidates: [
      {
        productId: "p1",
        merchant: "shoes.example",
        options: { Size: "10" },
        title: "Road Runner",
        baselinePrice: usd(7998),
      },
    ],
    maxUnitPrice: usd(8000),
    budget: usd(8000),
    allowedMerchants: ["shoes.example"],
    validUntil: new Date("2026-10-27T10:00:00.000Z"),
  },
});

test("a funded mandate survives a JSON round-trip with Money and Dates intact", () => {
  const m = {
    ...base,
    status: "funded" as const,
    authorization: { id: "A1", amount: usd(8000), expiresAt: new Date("2026-11-24T10:00:00.000Z") },
    captured: usd(1234),
  };
  const back = mandateFromJson(JSON.parse(JSON.stringify(mandateToJson(m))));
  expect(back).toEqual(m);
  expect(back.createdAt).toBeInstanceOf(Date);
  expect(back.terms.validUntil).toBeInstanceOf(Date);
  expect(back.authorization?.expiresAt).toBeInstanceOf(Date);
});

test("a mandate without authorization round-trips", () => {
  const back = mandateFromJson(JSON.parse(JSON.stringify(mandateToJson(base))));
  expect(back).toEqual(base);
  expect(back.authorization).toBeUndefined();
});

test("replay and voidAttempts round-trip; an old row without replay reads back false", () => {
  const m = { ...base, replay: true, voidAttempts: 2 };
  expect(mandateFromJson(JSON.parse(JSON.stringify(mandateToJson(m))))).toEqual(m);
  const { replay: _drop, ...old } = mandateToJson(base);
  expect(mandateFromJson(old).replay).toBe(false);
});

test("rejected items round-trip outside the digest; an old row without them reads back empty", () => {
  const rejected = [{ title: "Trap", merchant: "bad.example", details: ["Planted demo listing"] }];
  const m = newMandate({ id: "m1", ownerId: "u1", now, terms: base.terms, rejected });
  expect(m.digest).toBe(base.digest);
  expect(mandateFromJson(JSON.parse(JSON.stringify(mandateToJson(m))))).toEqual(m);
  const { rejected: _drop, ...old } = mandateToJson(base);
  expect(mandateFromJson(old).rejected).toEqual([]);
});

test("signed shops round-trip; an old row with one merchant reads as one shop, digest unchanged", () => {
  const [c] = base.terms.candidates;
  const shops = { ...must(c, "candidate"), merchants: ["shoes.example", "kicks.example"] };
  const m = newMandate({
    id: "m1",
    ownerId: "u1",
    now,
    terms: { ...base.terms, candidates: [shops] },
  });
  expect(mandateFromJson(JSON.parse(JSON.stringify(mandateToJson(m))))).toEqual(m);
  const old = mandateFromJson(JSON.parse(JSON.stringify(mandateToJson(base))));
  expect(shopsOf(must(old.terms.candidates[0], "candidate"))).toEqual(["shoes.example"]);
  expect(mandateDigest(old.id, old.terms, old.replay)).toBe(base.digest);
});

test("a renewed hold keeps its honor period and renewal time across a round-trip", () => {
  const m = {
    ...base,
    status: "funded" as const,
    authorization: {
      id: "A2",
      amount: usd(8000),
      expiresAt: new Date("2026-11-24T10:00:00.000Z"),
      honorUntil: new Date("2026-11-02T10:00:00.000Z"),
      renewedAt: new Date("2026-10-30T10:00:00.000Z"),
    },
  };
  const back = mandateFromJson(JSON.parse(JSON.stringify(mandateToJson(m))));
  expect(back).toEqual(m);
  expect(back.authorization?.renewedAt).toBeInstanceOf(Date);
});
