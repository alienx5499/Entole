import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** What happened to the order, in words for people; `status` stays the payment lifecycle. */
export const MandateOutcome = {
  /** Awaiting PayPal approval and still inside its window. */
  NeedsApproval: "needs_approval",
  /** The window ended before the human approved the hold. */
  Expired: "expired",
  /** Funded; the watcher is checking prices. */
  Watching: "watching",
  /** The watcher captured a purchase. */
  Bought: "bought",
  /** A purchase was captured and then refunded. */
  Refunded: "refunded",
  /** Closed without a purchase; PayPal released the hold. */
  Released: "released",
  /** Closed before PayPal ever approved a hold. */
  Cancelled: "cancelled",
} as const;
export type MandateOutcome = (typeof MandateOutcome)[keyof typeof MandateOutcome] | (string & {});

export const mandateOutcomeSchema: EnumSchema<MandateOutcome> = s.enumOf<MandateOutcome>(MandateOutcome);
