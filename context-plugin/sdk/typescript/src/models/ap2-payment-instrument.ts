import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/** The PayPal authorization hold the payment was captured from. */
export type Ap2PaymentInstrument = {
  /** The PayPal authorization id. */
  id: string;
  /** The instrument type, always `paypal.authorization`. */
  type: string;
  /** The instrument in words for people. */
  description?: string;
};

export const ap2PaymentInstrumentSchema: Schema<Ap2PaymentInstrument> = s.object<Ap2PaymentInstrument>({
  id: s.string(),
  type: s.string(),
  description: s.optional(s.string()),
});
