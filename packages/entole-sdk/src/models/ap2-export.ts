import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { ap2CheckoutMandateSchema, type Ap2CheckoutMandate } from "./ap2-checkout-mandate.js";
import { ap2EntoleContextSchema, type Ap2EntoleContext } from "./ap2-entole-context.js";
import { ap2OpenMandateSchema, type Ap2OpenMandate } from "./ap2-open-mandate.js";
import {
  ap2PaymentMandateInternalSchema,
  ap2PaymentMandateSchema,
  type Ap2PaymentMandate,
} from "./ap2-payment-mandate.js";

/** One limit order as unsigned Agent Payments Protocol v0.2 mandates. */
export type Ap2Export = {
  /** The protocol name, always `AP2`. @default "AP2" */
  protocol?: "AP2";
  /** The AP2 version the export follows, always `0.2`. @default "0.2" */
  version?: "0.2";
  /** Where the AP2 specification lives. */
  spec: string;
  /** The AP2 mode, always `human_not_present`. @default "human_not_present" */
  mode?: "human_not_present";
  /**
   * Always false; the claim sets are unsigned (see `note`), because Entole holds no buyer or agent
   * signing key.
   */
  signed: boolean;
  /** What being unsigned means. */
  note: string;
  /** Entole's own record of the order, which binds the AP2 mandates to the PayPal approval. */
  entole: Ap2EntoleContext;
  /**
   * An AP2 open mandate (`mandate.checkout.open.1` or `mandate.payment.open.1`). The constraint
   * objects follow the AP2 JSON schemas and are left open here.
   */
  openCheckoutMandate: Ap2OpenMandate;
  /**
   * An AP2 open mandate (`mandate.checkout.open.1` or `mandate.payment.open.1`). The constraint
   * objects follow the AP2 JSON schemas and are left open here.
   */
  openPaymentMandate: Ap2OpenMandate;
  /** AP2 `mandate.checkout.1`; null until the one capture. */
  checkoutMandate: Ap2CheckoutMandate | null;
  /** AP2 `mandate.payment.1`; null until the one capture. */
  paymentMandate: Ap2PaymentMandate | null;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

const ap2ExportProperties: s.Shape<Ap2Export> = {
  protocol: s.defaulted(s.literal("AP2"), "AP2"),
  version: s.defaulted(s.literal("0.2"), "0.2"),
  spec: s.string(),
  mode: s.defaulted(s.literal("human_not_present"), "human_not_present"),
  signed: s.boolean(),
  note: s.string(),
  entole: ap2EntoleContextSchema,
  openCheckoutMandate: ap2OpenMandateSchema,
  openPaymentMandate: ap2OpenMandateSchema,
  checkoutMandate: s.nullable(s.lazy(() => ap2CheckoutMandateSchema)),
  paymentMandate: s.nullable(s.lazy(() => ap2PaymentMandateInternalSchema)),
};

export const ap2ExportInternalSchema: Schema<Ap2Export> = s.object<Ap2Export>(ap2ExportProperties, {
  additionalProperties: s.json(),
});

export const ap2ExportSchema: Schema<Ap2Export> = s.lazySchema(() =>
  s.object<Ap2Export>(
    {
      ...ap2ExportProperties,
      spec: s.string().check(s.url()),
      paymentMandate: s.nullable(s.lazy(() => ap2PaymentMandateSchema)),
    },
    { additionalProperties: s.json() },
  ),
);
