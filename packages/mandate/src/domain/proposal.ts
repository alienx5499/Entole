import { createHash } from "node:crypto";
import type { Money } from "@entole/shared-kernel";

export type ResolvedOffer = {
  productId: string;
  title: string;
  merchant: string;
  brand: string;
  price: Money;
  attributes: Record<string, string>;
  url: string;
  inStock: boolean;
  condition: "new" | "used" | "unknown";
};

export type BlockReason =
  | "not_funded"
  | "closed"
  | "expired"
  | "merchant_not_allowed"
  | "merchant_mismatch"
  | "wrong_brand"
  | "avoided_term"
  | "not_a_candidate"
  | "wrong_attribute"
  | "over_unit_price"
  | "over_budget"
  | "product_unavailable"
  | "out_of_stock"
  | "not_new";

export type Verdict =
  | { kind: "allow" }
  | { kind: "block"; reasons: BlockReason[]; details: string[] };

/** Short fingerprint of what a capture pays for, so a reused PayPal-Request-Id can only replay this same capture. */
export const offerFingerprint = (offer: ResolvedOffer): string =>
  createHash("sha256")
    .update(`${offer.productId}|${offer.merchant}|${offer.price.cents}`)
    .digest("hex")
    .slice(0, 12);
