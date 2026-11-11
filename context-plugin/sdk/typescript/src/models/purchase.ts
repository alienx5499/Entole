import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { paypalCaptureResultSchema, type PaypalCaptureResult } from "./paypal-capture-result.js";
import { purchaseRationaleSchema, type PurchaseRationale } from "./purchase-rationale.js";
import { shipToSchema, type ShipTo } from "./ship-to.js";

/** The one purchase the watcher captured; null until it bought. */
export type Purchase = {
  /** The Channel3 product id that was bought. */
  productId: string;
  /** The bought product's title. */
  title: string;
  /** The shop it was bought from. */
  merchant: string;
  /** Shops with a live quote at the buy. */
  shopsCompared: number;
  /** A USD amount as a decimal string with two places. */
  price: string;
  /** The PayPal capture id. */
  captureId: string;
  /**
   * PayPal's own answer on the capture; each field is null on purchases made before it was
   * recorded.
   */
  paypal: PaypalCaptureResult;
  /**
   * Where the buyer's PayPal account says to ship, read from the approved order; null when the
   * approval carried no address. Entole does not place the shop order in this demo.
   */
  shipTo: ShipTo | null;
  /** A USD amount as a decimal string with two places. */
  savings: string;
  /** True when the order was signed in replay mode (recorded prices). */
  inReplay: boolean;
  /**
   * Why this item was bought, built from the deterministic check details in the audit trail, never
   * from model prose.
   */
  whyThisOne: PurchaseRationale;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

const purchaseProperties: s.Shape<Purchase> = {
  productId: s.string(),
  title: s.string(),
  merchant: s.string(),
  shopsCompared: s.int(),
  price: s.string(),
  captureId: s.string(),
  paypal: paypalCaptureResultSchema,
  shipTo: s.nullable(s.lazy(() => shipToSchema)),
  savings: s.string(),
  inReplay: s.boolean(),
  whyThisOne: purchaseRationaleSchema,
};

export const purchaseInternalSchema: Schema<Purchase> = s.object<Purchase>(purchaseProperties, {
  additionalProperties: s.json(),
});

export const purchaseSchema: Schema<Purchase> = s.lazySchema(() =>
  s.object<Purchase>(
    {
      ...purchaseProperties,
      price: s.string().check(s.pattern("^\\d+\\.\\d{2}$")),
      savings: s.string().check(s.pattern("^\\d+\\.\\d{2}$")),
    },
    { additionalProperties: s.json() },
  ),
);
