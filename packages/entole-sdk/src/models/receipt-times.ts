import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

/** When each step happened; null until it does. */
export type ReceiptTimes = {
  /** When the human approved the hold in PayPal. */
  approved: Date | null;
  /** When the watcher captured the purchase. */
  captured: Date | null;
  /** When the order closed with money released from the hold. */
  released: Date | null;
  /** When the capture was refunded. */
  refunded: Date | null;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const receiptTimesSchema: Schema<ReceiptTimes> = s.object<ReceiptTimes>(
  {
    approved: s.nullable(s.dateTime()),
    captured: s.nullable(s.dateTime()),
    released: s.nullable(s.dateTime()),
    refunded: s.nullable(s.dateTime()),
  },
  { additionalProperties: s.json() },
);
