import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/** AP2 `mandate.checkout.1`; null until the one capture. */
export type Ap2CheckoutMandate = {
  /**
   * The closed checkout mandate's type, always `mandate.checkout.1`.
   *
   * @default "mandate.checkout.1"
   */
  vct?: "mandate.checkout.1";
  /** The checkout as an unsecured JWT (alg none), since the shops do not sign checkouts. */
  checkoutJwt: string;
  /** Base64url SHA-256 of `checkout_jwt`. */
  checkoutHash: string;
  /** When it was issued, in Unix seconds (the capture time). */
  iat: number;
};

export const ap2CheckoutMandateSchema: Schema<Ap2CheckoutMandate> = s.object<Ap2CheckoutMandate>({
  vct: s.defaulted(s.literal("mandate.checkout.1"), "mandate.checkout.1"),
  checkoutJwt: s.string(),
  checkoutHash: s.string(),
  iat: s.int(),
  _keysMap: {
    checkoutJwt: "checkout_jwt",
    checkoutHash: "checkout_hash",
  },
});
