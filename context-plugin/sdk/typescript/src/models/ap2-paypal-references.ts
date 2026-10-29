import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/** The PayPal ids behind the order; each is null until that step happened. */
export type Ap2PaypalReferences = {
  /** The PayPal order id. */
  orderId: string | null;
  /** The order's custom_id at PayPal, equal to the digest. */
  customId: string;
  /** The PayPal authorization (hold) id. */
  authorizationId: string | null;
  /** The PayPal capture id. */
  captureId: string | null;
  /** The PayPal refund id. */
  refundId: string | null;
};

export const ap2PaypalReferencesSchema: Schema<Ap2PaypalReferences> = s.object<Ap2PaypalReferences>({
  orderId: s.nullable(s.string()),
  customId: s.string(),
  authorizationId: s.nullable(s.string()),
  captureId: s.nullable(s.string()),
  refundId: s.nullable(s.string()),
});
