import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** Where the order is in its PayPal payment lifecycle. */
export const MandateStatus = {
  /** Drafted; waiting for the human to approve the hold in PayPal. */
  AwaitingApproval: "awaiting_approval",
  /** PayPal holds the funds and the watcher may buy at or under the limit. */
  Funded: "funded",
  /** The one capture happened; the order is closed on the next watcher tick. */
  Exhausted: "exhausted",
  /** Finished; nothing more can be captured. */
  Closed: "closed",
} as const;
export type MandateStatus = (typeof MandateStatus)[keyof typeof MandateStatus] | (string & {});

export const mandateStatusSchema: EnumSchema<MandateStatus> = s.enumOf<MandateStatus>(MandateStatus);
