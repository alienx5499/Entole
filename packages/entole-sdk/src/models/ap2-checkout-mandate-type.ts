import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** The closed checkout mandate's type, always `mandate.checkout.1`. */
export const Ap2CheckoutMandateType = {
  /** AP2 closed checkout mandate, version 1. */
  MandateCheckout1: "mandate.checkout.1",
} as const;
export type Ap2CheckoutMandateType =
  | (typeof Ap2CheckoutMandateType)[keyof typeof Ap2CheckoutMandateType]
  | (string & {});

export const ap2CheckoutMandateTypeSchema: EnumSchema<Ap2CheckoutMandateType> =
  s.enumOf<Ap2CheckoutMandateType>(Ap2CheckoutMandateType);
