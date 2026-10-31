import { expect, test } from "bun:test";
import { type Mandate, type MandateStatus, newMandate } from "@entole/mandate";
import { parseUsd } from "@entole/shared-kernel";
import { type OfferEvent, shouldCheck } from "../../src/index.ts";

const limitMandate = (status: MandateStatus = "funded"): Mandate => ({
  ...newMandate({
    id: "m1",
    ownerId: "u1",
    now: new Date("2026-11-01T00:00:00Z"),
    terms: {
      kind: "limit",
      item: { query: "headphones", requiredAttributes: {}, brands: [], avoid: [] },
      candidates: [
        {
          productId: "p1",
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

const event = (e: Partial<OfferEvent>): OfferEvent => ({
  id: "evt_1",
  kind: "price",
  productId: "p1",
  domain: "shop.test",
  price: null,
  inStock: null,
  ...e,
});

test("price at the limit triggers", () => {
  expect(shouldCheck(limitMandate(), event({ price: parseUsd("450.00") }))).toBe(true);
});

test("price one cent over the limit does not", () => {
  expect(shouldCheck(limitMandate(), event({ price: parseUsd("450.01") }))).toBe(false);
});

test("back in stock triggers without a price", () => {
  expect(shouldCheck(limitMandate(), event({ kind: "availability", inStock: true }))).toBe(true);
});

test("going out of stock does not", () => {
  expect(shouldCheck(limitMandate(), event({ kind: "availability", inStock: false }))).toBe(false);
});

test("new offer at the limit triggers", () => {
  expect(shouldCheck(limitMandate(), event({ kind: "created", price: parseUsd("450.00") }))).toBe(
    true,
  );
});

test("other product does not trigger", () => {
  expect(shouldCheck(limitMandate(), event({ productId: "p2", price: parseUsd("1.00") }))).toBe(
    false,
  );
});

test("price under the limit at a shop the mandate never signed does not trigger", () => {
  expect(
    shouldCheck(limitMandate(), event({ domain: "other.test", price: parseUsd("1.00") })),
  ).toBe(false);
});

test("a signed shop matches whatever its case", () => {
  expect(shouldCheck(limitMandate(), event({ domain: "Shop.TEST", price: parseUsd("1.00") }))).toBe(
    true,
  );
});

test("back in stock at a shop the mandate never signed does not trigger", () => {
  expect(
    shouldCheck(
      limitMandate(),
      event({ kind: "availability", domain: "other.test", inStock: true }),
    ),
  ).toBe(false);
});

test("any of a candidate's signed shops triggers", () => {
  const m = limitMandate();
  const candidates = m.terms.candidates.map((c) => ({
    ...c,
    merchants: ["shop.test", "second.test"],
  }));
  const multi = { ...m, terms: { ...m.terms, candidates } };
  expect(shouldCheck(multi, event({ domain: "second.test", price: parseUsd("1.00") }))).toBe(true);
  expect(shouldCheck(multi, event({ domain: "third.test", price: parseUsd("1.00") }))).toBe(false);
});

test("exhausted or unfunded mandate does not trigger", () => {
  const e = event({ price: parseUsd("1.00") });
  expect(shouldCheck(limitMandate("exhausted"), e)).toBe(false);
  expect(shouldCheck(limitMandate("awaiting_approval"), e)).toBe(false);
  expect(shouldCheck(limitMandate("closed"), e)).toBe(false);
});

test("price event without a price does not trigger", () => {
  expect(shouldCheck(limitMandate(), event({ price: null }))).toBe(false);
});

test("availability without stock info does not trigger", () => {
  expect(shouldCheck(limitMandate(), event({ kind: "availability", inStock: null }))).toBe(false);
});

test("new offer over the limit does not trigger", () => {
  expect(shouldCheck(limitMandate(), event({ kind: "created", price: parseUsd("450.01") }))).toBe(
    false,
  );
});

test("new offer without a price does not trigger", () => {
  expect(shouldCheck(limitMandate(), event({ kind: "created", price: null }))).toBe(false);
});

test("standard mandate does not trigger", () => {
  const m = limitMandate();
  const standard = { ...m, terms: { ...m.terms, kind: "standard" as const } };
  expect(shouldCheck(standard, event({ price: parseUsd("1.00") }))).toBe(false);
});
