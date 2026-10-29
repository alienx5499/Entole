import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** The closed payment mandate's type, always `mandate.payment.1`. */
export const Ap2PaymentMandateType = {
  /** AP2 closed payment mandate, version 1. */
  MandatePayment1: "mandate.payment.1",
} as const;
export type Ap2PaymentMandateType =
  | (typeof Ap2PaymentMandateType)[keyof typeof Ap2PaymentMandateType]
  | (string & {});

export const ap2PaymentMandateTypeSchema: EnumSchema<Ap2PaymentMandateType> =
  s.enumOf<Ap2PaymentMandateType>(Ap2PaymentMandateType);
