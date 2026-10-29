import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/** The signed terms; their SHA-256 is the order's `digest`. */
export type MandateTerms = {
  /** What to buy, as the human wrote it. */
  query: string;
  /** Brands the item must be from; empty means any brand. */
  brands: string[];
  /** Words that rule an item out. */
  avoid: string[];
  /** Attributes the item must have, by name. */
  requiredAttributes: Record<string, string>;
  /** A USD amount as a decimal string with two places. */
  limitPrice: string;
  /** A USD amount as a decimal string with two places. */
  budget: string;
  /** Empty means any shop; the signed candidates pin the items. */
  allowedMerchants: string[];
};

export const mandateTermsSchema: Schema<MandateTerms> = s.object<MandateTerms>({
  query: s.string(),
  brands: s.array(s.string()),
  avoid: s.array(s.string()),
  requiredAttributes: s.record(s.string(), s.string()),
  limitPrice: s.string(),
  budget: s.string(),
  allowedMerchants: s.array(s.string()),
});
