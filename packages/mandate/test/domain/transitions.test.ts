import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import {
  AmountMismatch,
  checkApproval,
  close,
  DigestMismatch,
  fund,
  InvalidTransition,
  type Mandate,
  newMandate,
  OrderNotApproved,
  recordCapture,
  remaining,
} from "../../src/index.ts";

const now = new Date("2026-10-26T00:00:00Z");
const fresh = () =>
  newMandate({
    id: "m1",
    ownerId: "u1",
    now,
    terms: {
      kind: "standard",
      candidates: [],
      item: { query: "shoes", requiredAttributes: {}, brands: [], avoid: [] },
      maxUnitPrice: usd(8000),
      budget: usd(8000),
      allowedMerchants: [],
      validUntil: new Date("2026-10-28T00:00:00Z"),
    },
  });
const auth = (m: Mandate, over = {}) => ({
  id: "A1",
  amount: usd(8000),
  expiresAt: new Date("2026-11-24T00:00:00Z"),
  customId: m.digest,
  ...over,
});
const freezeAll = (m: Mandate) => Object.freeze(m);

test("fund checks digest, amount and status", () => {
  const m = freezeAll(fresh());
  expect(() => fund(m, auth(m, { customId: "bad" }))).toThrow(DigestMismatch);
  expect(() => fund(m, auth(m, { amount: usd(7999) }))).toThrow(AmountMismatch);
  const f = fund(m, auth(m));
  expect(f.status).toBe("funded");
  expect(f.authorization?.id).toBe("A1");
  expect(m.status).toBe("awaiting_approval");
  expect(() => fund(f, auth(f))).toThrow(InvalidTransition);
});
test("captures reduce remaining, then exhaust", () => {
  const m0 = fresh();
  expect(() => recordCapture(m0, usd(100))).toThrow(InvalidTransition);
  const m1 = freezeAll(recordCapture(fund(m0, auth(m0)), usd(7200)));
  expect(remaining(m1).cents).toBe(800);
  expect(() => recordCapture(m1, usd(801))).toThrow();
  const m2 = recordCapture(m1, usd(800));
  expect(m2.status).toBe("exhausted");
  expect(() => recordCapture(m2, usd(1))).toThrow(InvalidTransition);
});
test("close voids once", () => {
  const m0 = fresh();
  const m1 = freezeAll(recordCapture(fund(m0, auth(m0)), usd(7200)));
  const a = close(m1);
  expect(a.voidNeeded).toBe(true);
  expect(a.mandate.status).toBe("closed");
  expect(a.mandate.voided).toBe(true);
  expect(m1.status).toBe("funded");
  expect(close(a.mandate).voidNeeded).toBe(false);
});
test("close when exhausted or unfunded needs no void", () => {
  const m0 = fresh();
  const ex = recordCapture(fund(m0, auth(m0)), usd(8000));
  const r = close(ex);
  expect(r.voidNeeded).toBe(false);
  expect(r.mandate.status).toBe("closed");
  expect(close(freezeAll(m0)).voidNeeded).toBe(false);
});

test("limit mandate is exhausted after one capture", () => {
  const m = newMandate({
    id: "m2",
    ownerId: "u1",
    now,
    terms: {
      kind: "limit",
      candidates: [
        { productId: "p1", merchant: "a.com", options: {}, title: "S", baselinePrice: usd(15900) },
      ],
      item: { query: "shoes", requiredAttributes: {}, brands: [], avoid: [] },
      maxUnitPrice: usd(17000),
      budget: usd(17000),
      allowedMerchants: [],
      validUntil: new Date("2026-10-28T00:00:00Z"),
    },
  });
  const f = fund(m, { ...auth(m), amount: usd(17000) });
  const done = recordCapture(f, usd(15900));
  expect(done.status).toBe("exhausted");
  expect(remaining({ ...done, status: "funded" }).cents).toBe(1100);
});

const limitFunded = () => {
  const m = newMandate({
    id: "m3",
    ownerId: "u1",
    now,
    terms: {
      kind: "limit",
      candidates: [
        { productId: "p1", merchant: "a.com", options: {}, title: "S", baselinePrice: usd(15900) },
      ],
      item: { query: "shoes", requiredAttributes: {}, brands: [], avoid: [] },
      maxUnitPrice: usd(17000),
      budget: usd(17000),
      allowedMerchants: [],
      validUntil: new Date("2026-10-28T00:00:00Z"),
    },
  });
  return fund(m, { ...auth(m), amount: usd(17000) });
};
test("closing an exhausted limit mandate voids the remainder", () => {
  const done = recordCapture(limitFunded(), usd(15900));
  expect(done.status).toBe("exhausted");
  const r = close(done);
  expect(r.voidNeeded).toBe(true);
  expect(r.mandate.status).toBe("closed");
  expect(r.mandate.voided).toBe(true);
  expect(close(r.mandate).voidNeeded).toBe(false);
});
test("closing a fully captured standard mandate needs no void", () => {
  const f = fund(fresh(), auth(fresh()));
  const done = recordCapture(f, usd(8000));
  expect(done.status).toBe("exhausted");
  expect(close(done).voidNeeded).toBe(false);
});

test("checkApproval passes APPROVED or COMPLETED orders that match the signed terms", () => {
  const m = fresh();
  const order = { amount: usd(8000), customId: m.digest };
  expect(() => checkApproval(m, { ...order, status: "APPROVED" })).not.toThrow();
  expect(() => checkApproval(m, { ...order, status: "COMPLETED" })).not.toThrow();
});

test("checkApproval refuses by status, then digest, then amount", () => {
  const m = fresh();
  const ok = { status: "APPROVED", amount: usd(8000), customId: m.digest };
  const cases = [
    [{ ...ok, status: "PAYER_ACTION_REQUIRED", customId: "x", amount: usd(1) }, OrderNotApproved],
    [{ ...ok, status: "VOIDED" }, OrderNotApproved],
    [{ ...ok, customId: "x", amount: usd(1) }, DigestMismatch],
    [{ ...ok, amount: usd(7999) }, AmountMismatch],
    [{ ...ok, amount: { cents: 8000, currency: "EUR" } }, AmountMismatch],
  ] as const;
  for (const [order, error] of cases) expect(() => checkApproval(m, order)).toThrow(error);
});
