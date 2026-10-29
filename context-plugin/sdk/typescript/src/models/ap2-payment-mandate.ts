import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { ap2MerchantSchema, type Ap2Merchant } from "./ap2-merchant.js";
import { ap2PaymentAmountSchema, type Ap2PaymentAmount } from "./ap2-payment-amount.js";
import { ap2PaymentInstrumentSchema, type Ap2PaymentInstrument } from "./ap2-payment-instrument.js";

/** AP2 `mandate.payment.1`; null until the one capture. */
export type Ap2PaymentMandate = {
  /** The closed payment mandate's type, always `mandate.payment.1`. @default "mandate.payment.1" */
  vct?: "mandate.payment.1";
  /** The checkout mandate's `checkout_hash`, which ties the payment to that checkout. */
  transactionId: string;
  /**
   * An AP2 merchant. As a payee it is always Entole, the account that receives the funds in this
   * sandbox demo; the shops are not paid.
   */
  payee: Ap2Merchant;
  /** The amount paid, in minor units. */
  paymentAmount: Ap2PaymentAmount;
  /** The PayPal authorization hold the payment was captured from. */
  paymentInstrument: Ap2PaymentInstrument;
  /** When the capture happened. */
  executionDate: Date;
  /** When it was issued, in Unix seconds (the capture time). */
  iat: number;
};

export const ap2PaymentMandateSchema: Schema<Ap2PaymentMandate> = s.object<Ap2PaymentMandate>({
  vct: s.defaulted(s.literal("mandate.payment.1"), "mandate.payment.1"),
  transactionId: s.string(),
  payee: ap2MerchantSchema,
  paymentAmount: ap2PaymentAmountSchema,
  paymentInstrument: ap2PaymentInstrumentSchema,
  executionDate: s.dateTime(),
  iat: s.int(),
  _keysMap: {
    transactionId: "transaction_id",
    paymentAmount: "payment_amount",
    paymentInstrument: "payment_instrument",
    executionDate: "execution_date",
  },
});
