import { add, lte, type Money, usd } from "@entole/shared-kernel";
import { remaining } from "./check.ts";
import type { Mandate, ShipTo } from "./mandate.ts";

export class DigestMismatch extends Error {}
export class AmountMismatch extends Error {}
export class InvalidTransition extends Error {}

export const fund = (
  m: Mandate,
  auth: { id: string; amount: Money; expiresAt: Date; customId: string; shipTo?: ShipTo },
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
    authorization: { id: auth.id, amount: auth.amount, expiresAt: auth.expiresAt },
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
