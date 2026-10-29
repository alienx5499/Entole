import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** The open mandate's type. */
export const Ap2OpenMandateType = {
  /** Open checkout mandate; constrains which shops and items may be bought. */
  MandateCheckoutOpen1: "mandate.checkout.open.1",
  /** Open payment mandate; constrains the amount, payee, instrument and date. */
  MandatePaymentOpen1: "mandate.payment.open.1",
} as const;
export type Ap2OpenMandateType = (typeof Ap2OpenMandateType)[keyof typeof Ap2OpenMandateType] | (string & {});

export const ap2OpenMandateTypeSchema: EnumSchema<Ap2OpenMandateType> =
  s.enumOf<Ap2OpenMandateType>(Ap2OpenMandateType);
