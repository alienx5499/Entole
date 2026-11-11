import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

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
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

const receiptAmountsProperties: s.Shape<ReceiptAmounts> = {
  held: s.string(),
  captured: s.string(),
  released: s.string(),
  refunded: s.string(),
};

export const receiptAmountsInternalSchema: Schema<ReceiptAmounts> = s.object<ReceiptAmounts>(
  receiptAmountsProperties,
  { additionalProperties: s.json() },
);

export const receiptAmountsSchema: Schema<ReceiptAmounts> = s.lazySchema(() =>
  s.object<ReceiptAmounts>(
    {
      ...receiptAmountsProperties,
      held: s.string().check(s.pattern("^\\d+\\.\\d{2}$")),
      captured: s.string().check(s.pattern("^\\d+\\.\\d{2}$")),
      released: s.string().check(s.pattern("^\\d+\\.\\d{2}$")),
      refunded: s.string().check(s.pattern("^\\d+\\.\\d{2}$")),
    },
    { additionalProperties: s.json() },
  ),
);
