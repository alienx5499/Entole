import type { Money } from "@entole/shared-kernel";

export type ResolvedOffer = {
  productId: string;
  title: string;
  merchant: string;
  brand: string;
  price: Money;
  attributes: Record<string, string>;
  url: string;
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
  | "product_unavailable";

export type Verdict =
  | { kind: "allow" }
  | { kind: "block"; reasons: BlockReason[]; details: string[] };
