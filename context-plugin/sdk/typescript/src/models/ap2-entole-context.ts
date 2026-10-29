import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { ap2PaypalReferencesSchema, type Ap2PaypalReferences } from "./ap2-paypal-references.js";
import { mandateStatusSchema, type MandateStatus } from "./mandate-status.js";

/** Entole's own record of the order, which binds the AP2 mandates to the PayPal approval. */
export type Ap2EntoleContext = {
  /** The limit order id. */
  mandateId: string;
  /** Where the order is in its PayPal payment lifecycle. */
  status: MandateStatus;
  /** SHA-256 of the signed terms, hex; also the PayPal order's custom_id. */
  digest: string;
  /** The hash behind `digest`, always `sha-256`. @default "sha-256" */
  digestAlgorithm?: "sha-256";
  /** The PayPal ids behind the order; each is null until that step happened. */
  paypal: Ap2PaypalReferences;
};

export const ap2EntoleContextSchema: Schema<Ap2EntoleContext> = s.object<Ap2EntoleContext>({
  mandateId: s.string(),
  status: mandateStatusSchema,
  digest: s.string(),
  digestAlgorithm: s.defaulted(s.literal("sha-256"), "sha-256"),
  paypal: ap2PaypalReferencesSchema,
});
