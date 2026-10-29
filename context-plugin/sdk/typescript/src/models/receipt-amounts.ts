import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/** The hold's money, each a decimal string in USD; "0.00" when it did not happen. */
export type ReceiptAmounts = {
  /** A USD amount as a decimal string with two places. */
  held: string;
  /** A USD amount as a decimal string with two places. */
  captured: string;
  /** A USD amount as a decimal string with two places. */
  released: string;
  /** A USD amount as a decimal string with two places. */
  refunded: string;
};

export const receiptAmountsSchema: Schema<ReceiptAmounts> = s.object<ReceiptAmounts>({
  held: s.string(),
  captured: s.string(),
  released: s.string(),
  refunded: s.string(),
});
