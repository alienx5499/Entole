import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/**
 * One shortlisted item the human signs for: a product, its options and the shops it may be bought
 * from. Part of the signed digest.
 */
export type Candidate = {
  /** The Channel3 product id. */
  productId: string;
  /** The shop the item was shortlisted at. */
  merchant: string;
  /** Every signed shop, `merchant` first. */
  shops: string[];
  /** The product title from the listing. */
  title: string;
  /** The signed variant options, such as color or size. */
  options: Record<string, string>;
  /** A USD amount as a decimal string with two places. */
  baselinePrice: string;
};

export const candidateSchema: Schema<Candidate> = s.object<Candidate>({
  productId: s.string(),
  merchant: s.string(),
  shops: s.array(s.string()),
  title: s.string(),
  options: s.record(s.string(), s.string()),
  baselinePrice: s.string(),
});
