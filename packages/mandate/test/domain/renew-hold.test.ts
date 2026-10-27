import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import {
  fund,
  HONOR_PERIOD_MS,
  InvalidTransition,
  MAX_LIMIT_WINDOW_MS,
  type Mandate,
  needsRenewal,
  newMandate,
  renewHold,
} from "../../src/index.ts";

const DAY = 24 * 3600 * 1000;
const approvedAt = new Date("2026-10-28T00:00:00Z");
const at = (days: number) => new Date(approvedAt.getTime() + days * DAY);

const limitMandate = (validDays = 20) =>
  newMandate({
    id: "m1",
    ownerId: "u1",
    now: approvedAt,
    terms: {
      kind: "limit",
      candidates: [
        {
          productId: "p1",
          merchant: "shop.test",
          options: {},
          title: "Shoe",
          baselinePrice: usd(9000),
        },
      ],
      item: { query: "shoes", requiredAttributes: {}, brands: [], avoid: [] },
      maxUnitPrice: usd(8000),
      budget: usd(8000),
      allowedMerchants: [],
      validUntil: at(validDays),
    },
  });

const funded = (validDays = 20): Mandate =>
  fund(limitMandate(validDays), {
    id: "A1",
    amount: usd(8000),
    expiresAt: at(29),
    customId: limitMandate(validDays).digest,
    authorizedAt: approvedAt,
  });

test("a limit order may run 29 days, a standard one still 3", () => {
  expect(MAX_LIMIT_WINDOW_MS).toBe(29 * DAY);
  expect(() => limitMandate(29)).not.toThrow();
  expect(() =>
    newMandate({
      id: "m1",
      ownerId: "u1",
      now: approvedAt,
      terms: { ...limitMandate().terms, validUntil: new Date(at(29).getTime() + 1) },
    }),
  ).toThrow("29 days");
  expect(() =>
    newMandate({
      id: "m1",
      ownerId: "u1",
      now: approvedAt,
      terms: {
        ...limitMandate().terms,
        kind: "standard",
        candidates: [],
        validUntil: at(4),
      },
    }),
  ).toThrow("3 days");
});

test("fund starts the honor period at approval; without authorizedAt there is none", () => {
  expect(funded().authorization?.honorUntil).toEqual(
    new Date(approvedAt.getTime() + HONOR_PERIOD_MS),
  );
  const m = limitMandate();
  const old = fund(m, { id: "A1", amount: usd(8000), expiresAt: at(29), customId: m.digest });
  expect(old.authorization?.honorUntil).toBeUndefined();
  expect(needsRenewal(old, at(5))).toBe(false);
});

test("renewal is due only after the honor period, while the order and the hold are open", () => {
  const m = funded();
  expect(needsRenewal(m, at(2))).toBe(false);
  expect(needsRenewal(m, at(3))).toBe(true);
  expect(needsRenewal(m, at(19))).toBe(true);
  // Order over: nothing to renew for.
  expect(needsRenewal(m, at(20))).toBe(false);
  // Beyond the 29-day hold PayPal needs a new authorization, not a renewal.
  const long = funded(29);
  expect(needsRenewal(long, at(28))).toBe(true);
  expect(needsRenewal(long, at(29))).toBe(false);
  expect(needsRenewal({ ...m, status: "exhausted" }, at(4))).toBe(false);
});

test("renewHold swaps the id, restarts the honor period and keeps the 29-day expiry", () => {
  const r = renewHold(funded(), "A2", at(4));
  expect(r.authorization).toEqual({
    id: "A2",
    amount: usd(8000),
    expiresAt: at(29),
    honorUntil: at(7),
    renewedAt: at(4),
  });
  // Renewed once: PayPal refuses to renew a renewed hold.
  expect(needsRenewal(r, at(8))).toBe(false);
  expect(() => renewHold(r, "A3", at(8))).toThrow(InvalidTransition);
});

test("a renewal late in the hold gets an honor period cut at the expiry", () => {
  const r = renewHold(funded(29), "A2", at(27.5));
  expect(r.authorization?.honorUntil).toEqual(at(29));
});

test("renewHold refuses inside the honor period", () => {
  expect(() => renewHold(funded(), "A2", at(1))).toThrow(InvalidTransition);
});
