import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

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
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

const candidateProperties: s.Shape<Candidate> = {
  productId: s.string(),
  merchant: s.string(),
  shops: s.array(s.string()),
  title: s.string(),
  options: s.record(s.string(), s.string()),
  baselinePrice: s.string(),
};

export const candidateInternalSchema: Schema<Candidate> = s.object<Candidate>(candidateProperties, {
  additionalProperties: s.json(),
});

export const candidateSchema: Schema<Candidate> = s.lazySchema(() =>
  s.object<Candidate>(
    {
      ...candidateProperties,
      baselinePrice: s.string().check(s.pattern("^\\d+\\.\\d{2}$")),
    },
    { additionalProperties: s.json() },
  ),
);
