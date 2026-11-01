import { expect, test } from "bun:test";
import { type Mandate, type MandateStatus, newMandate } from "@entole/mandate";
import { parseUsd } from "@entole/shared-kernel";
import {
  classifyOfferEvent,
  type NoteReason,
  type OfferEvent,
  shouldCheck,
} from "../../src/index.ts";

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

const note = (reason: NoteReason) => ({ kind: "note" as const, reason });

test("classifies a price above the limit as a note and at the limit as a wake", () => {
  expect(classifyOfferEvent(limitMandate(), event({ price: parseUsd("450.01") }))).toEqual(
    note("above_limit"),
  );
  expect(classifyOfferEvent(limitMandate(), event({ price: parseUsd("450.00") }))).toEqual({
    kind: "wake",
  });
});

test("classifies stock changes: out of stock is a note, back in stock a wake", () => {
  const m = limitMandate();
  expect(classifyOfferEvent(m, event({ kind: "availability", inStock: false }))).toEqual(
    note("out_of_stock"),
  );
  expect(classifyOfferEvent(m, event({ kind: "availability", inStock: true }))).toEqual({
    kind: "wake",
  });
  expect(classifyOfferEvent(m, event({ kind: "availability", inStock: null }))).toBeNull();
});

test("classifies a new offer above the limit as a note", () => {
  expect(
    classifyOfferEvent(
      limitMandate(),
      event({ kind: "created", price: parseUsd("889.99"), inStock: true }),
    ),
  ).toEqual(note("new_offer_above_limit"));
});

test("classifies nothing for another product, an unsigned shop or an order not watching", () => {
  const e = event({ price: parseUsd("889.99") });
  expect(classifyOfferEvent(limitMandate(), { ...e, productId: "p2" })).toBeNull();
  expect(classifyOfferEvent(limitMandate(), { ...e, domain: "other.test" })).toBeNull();
  expect(classifyOfferEvent(limitMandate("closed"), e)).toBeNull();
  expect(classifyOfferEvent(limitMandate("exhausted"), e)).toBeNull();
  expect(classifyOfferEvent(limitMandate(), event({ price: null }))).toBeNull();
});
