import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { holdRenewalSchema, type HoldRenewal } from "./hold-renewal.js";
import { paypalConfirmationSchema, type PaypalConfirmation } from "./paypal-confirmation.js";
import { receiptAmountsSchema, type ReceiptAmounts } from "./receipt-amounts.js";
import { receiptTimesSchema, type ReceiptTimes } from "./receipt-times.js";

/** Everything PayPal-side for the order, from the order and its audit trail. */
export type Receipt = {
  /** The PayPal order id created with the draft. */
  paypalOrderId: string | null;
  /** The current PayPal authorization (hold) id; null before approval. */
  authorizationId: string | null;
  /** The PayPal capture id; null until the watcher bought. */
  captureId: string | null;
  /** The PayPal refund id; null unless the capture was refunded. */
  refundId: string | null;
  /** The digest sent to PayPal as the order's custom_id. */
  customId: string;
  /** Set once the watcher renewed the PayPal hold after its 3-day honor period; null otherwise. */
  holdRenewed: HoldRenewal | null;
  /** The hold's money, each a decimal string in USD; "0.00" when it did not happen. */
  amounts: ReceiptAmounts;
  /** When each step happened; null until it does. */
  times: ReceiptTimes;
  /** PayPal webhook confirmations, oldest first. */
  confirmations: PaypalConfirmation[];
};

export const receiptSchema: Schema<Receipt> = s.object<Receipt>({
  paypalOrderId: s.nullable(s.string()),
  authorizationId: s.nullable(s.string()),
  captureId: s.nullable(s.string()),
  refundId: s.nullable(s.string()),
  customId: s.string(),
  holdRenewed: s.nullable(s.lazy(() => holdRenewalSchema)),
  amounts: receiptAmountsSchema,
  times: receiptTimesSchema,
  confirmations: s.array(s.lazy(() => paypalConfirmationSchema)),
});
