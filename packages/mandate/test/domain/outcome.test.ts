import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import { type Mandate, newMandate, outcomeOf } from "../../src/index.ts";

const now = new Date("2026-10-26T00:00:00Z");
const later = new Date("2026-10-29T00:00:00Z");
const base = newMandate({
  id: "m1",
  ownerId: "u1",
  now,
  terms: {
    kind: "standard",
    candidates: [],
    item: { query: "running shoes", requiredAttributes: {}, brands: [], avoid: [] },
    maxUnitPrice: usd(8000),
    budget: usd(8000),
    allowedMerchants: [],
    validUntil: new Date("2026-10-28T00:00:00Z"),
  },
});
const at = (over: Partial<Mandate>) => ({ ...base, ...over });

test("an unapproved mandate needs approval until its window ends, then it expired", () => {
  expect(outcomeOf(base, now)).toBe("needs_approval");
  expect(outcomeOf(base, later)).toBe("expired");
});

test("a funded mandate with nothing captured is watching", () => {
  expect(outcomeOf(at({ status: "funded" }), now)).toBe("watching");
});

test("any capture means bought, whether or not the rest was released yet", () => {
  expect(outcomeOf(at({ status: "exhausted", captured: usd(5000) }), now)).toBe("bought");
  expect(outcomeOf(at({ status: "closed", captured: usd(5000) }), later)).toBe("bought");
});

test("a fully refunded capture is refunded", () => {
  const refund = { id: "R1", amount: usd(5000) };
  expect(outcomeOf(at({ status: "closed", captured: usd(5000), refund }), later)).toBe("refunded");
});

test("closed with nothing captured is released, or cancelled if never approved", () => {
  const hold = { id: "A1", amount: usd(8000), expiresAt: later };
  expect(outcomeOf(at({ status: "closed", authorization: hold }), later)).toBe("released");
  expect(outcomeOf(at({ status: "closed" }), now)).toBe("cancelled");
});
