import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { mandateOutcomeSchema, type MandateOutcome } from "./mandate-outcome.js";
import { mandateStatusSchema, type MandateStatus } from "./mandate-status.js";

/** One row of the owner's order list. */
export type MandateSummary = {
  /** The limit order id, `mandate_` followed by a UUID. */
  id: string;
  /** Where the order is in its PayPal payment lifecycle. */
  status: MandateStatus;
  /** What happened to the order, in words for people; `status` stays the payment lifecycle. */
  outcome: MandateOutcome;
  /** What the order is for, as the human wrote it. */
  query: string;
  /** A USD amount as a decimal string with two places. */
  limitPrice: string;
  /** A USD amount as a decimal string with two places. */
  captured: string;
  /** When the order was drafted. */
  createdAt: Date;
  /** When the order stops watching prices. */
  validUntil: Date;
};

export const mandateSummarySchema: Schema<MandateSummary> = s.object<MandateSummary>({
  id: s.string(),
  status: mandateStatusSchema,
  outcome: mandateOutcomeSchema,
  query: s.string(),
  limitPrice: s.string(),
  captured: s.string(),
  createdAt: s.dateTime(),
  validUntil: s.dateTime(),
});
