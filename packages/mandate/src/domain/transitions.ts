import { add, lte, type Money, usd } from "@entole/shared-kernel";
import { remaining } from "./check.ts";
import { HONOR_PERIOD_MS, type Mandate, type ShipTo } from "./mandate.ts";

export class DigestMismatch extends Error {}
export class AmountMismatch extends Error {}
export class InvalidTransition extends Error {}

export const fund = (
  m: Mandate,
  auth: {
    id: string;
    amount: Money;
    expiresAt: Date;
    customId: string;
    shipTo?: ShipTo;
    // When PayPal placed the hold; starts the 3-day honor period.
    authorizedAt?: Date;
  },
): Mandate => {
  if (m.status !== "awaiting_approval")
    throw new InvalidTransition(`Cannot fund a ${m.status} mandate`);
  if (auth.customId !== m.digest)
    throw new DigestMismatch("Authorization does not match the mandate digest");
  if (auth.amount.cents !== m.terms.budget.cents)
    throw new AmountMismatch("Authorization amount differs from budget");
  return {
    ...m,
    status: "funded",
    authorization: {
      id: auth.id,
      amount: auth.amount,
      expiresAt: auth.expiresAt,
      ...(auth.authorizedAt ? { honorUntil: honorEnd(auth.authorizedAt, auth.expiresAt) } : {}),
    },
    ...(auth.shipTo ? { shipTo: auth.shipTo } : {}),
  };
};

// A final capture means PayPal released the rest of the hold in the same call, so close has
// nothing left to void.
export const recordCapture = (m: Mandate, amount: Money, final = false): Mandate => {
  if (m.status !== "funded") throw new InvalidTransition(`Cannot capture on a ${m.status} mandate`);
  if (!lte(amount, remaining(m))) throw new RangeError("Capture is above the remaining budget");
  const captured = add(m.captured, amount);
  return {
    ...m,
    captured,
    voided: m.voided || final,
    status:
      m.terms.kind === "limit" || amount.cents === remaining(m).cents ? "exhausted" : "funded",
  };
};

// released is what left the hold: voided now, or already released by a final capture.
export const close = (m: Mandate): { mandate: Mandate; voidNeeded: boolean; released: Money } => {
  const holding = (m.status === "funded" || m.status === "exhausted") && remaining(m).cents > 0;
  const voidNeeded = holding && !m.voided;
  return {
    mandate: { ...m, status: "closed", voided: m.voided || voidNeeded },
    voidNeeded,
    released: holding ? remaining(m) : usd(0),
  };
};

const honorEnd = (from: Date, expiresAt: Date): Date =>
  new Date(Math.min(from.getTime() + HONOR_PERIOD_MS, expiresAt.getTime()));

// A funded hold is renewed once: after its honor period, while the order is still open and the
// 29-day hold is still valid. PayPal refuses to renew a renewed hold, so there is no second try.
export const needsRenewal = (m: Mandate, now: Date): boolean => {
  const a = m.authorization;
  const t = now.getTime();
  return (
    m.status === "funded" &&
    a?.honorUntil !== undefined &&
    a.renewedAt === undefined &&
    t >= a.honorUntil.getTime() &&
    t < a.expiresAt.getTime() &&
    t < m.terms.validUntil.getTime()
  );
};

// The renewed hold has a new id and a fresh 3-day honor period, capped at the original expiry.
export const renewHold = (m: Mandate, authorizationId: string, now: Date): Mandate => {
  if (!needsRenewal(m, now) || !m.authorization)
    throw new InvalidTransition("This hold cannot be renewed now");
  return {
    ...m,
    authorization: {
      ...m.authorization,
      id: authorizationId,
      honorUntil: honorEnd(now, m.authorization.expiresAt),
      renewedAt: now,
    },
  };
};
