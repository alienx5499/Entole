import { add, lte, type Money } from "@entole/shared-kernel";
import { remaining } from "./check.ts";
import type { Mandate } from "./mandate.ts";

export class DigestMismatch extends Error {}
export class AmountMismatch extends Error {}
export class InvalidTransition extends Error {}

export const fund = (
  m: Mandate,
  auth: { id: string; amount: Money; expiresAt: Date; customId: string },
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
  };
};

export const recordCapture = (m: Mandate, amount: Money): Mandate => {
  if (m.status !== "funded") throw new InvalidTransition(`Cannot capture on a ${m.status} mandate`);
  if (!lte(amount, remaining(m))) throw new RangeError("Capture is above the remaining budget");
  const captured = add(m.captured, amount);
  return {
    ...m,
    captured,
    status:
      m.terms.kind === "limit" || amount.cents === remaining(m).cents ? "exhausted" : "funded",
  };
};

export const close = (m: Mandate): { mandate: Mandate; voidNeeded: boolean } => {
  const voidNeeded =
    (m.status === "funded" || m.status === "exhausted") && remaining(m).cents > 0 && !m.voided;
  return { mandate: { ...m, status: "closed", voided: m.voided || voidNeeded }, voidNeeded };
};
