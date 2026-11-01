import type { Mandate } from "./mandate.ts";

export const MANDATE_OUTCOMES = [
  "needs_approval",
  "expired",
  "watching",
  "bought",
  "refunded",
  "released",
  "cancelled",
] as const;

/** What happened to a mandate, for people; `status` stays the payment lifecycle. */
export type MandateOutcome = (typeof MANDATE_OUTCOMES)[number];

export const outcomeOf = (m: Mandate, now: Date): MandateOutcome => {
  if (m.captured.cents > 0) return m.refund ? "refunded" : "bought";
  switch (m.status) {
    case "awaiting_approval":
      return now.getTime() >= m.terms.validUntil.getTime() ? "expired" : "needs_approval";
    case "funded":
      return "watching";
    default:
      // Closed before PayPal ever approved a hold: the buyer cancelled it.
      return m.authorization ? "released" : "cancelled";
  }
};
