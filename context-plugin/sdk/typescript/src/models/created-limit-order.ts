import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { candidateInternalSchema, candidateSchema, type Candidate } from "./candidate.js";
import { rejectedSchema, type Rejected } from "./rejected.js";

/** A drafted limit order; nothing is held until the human approves at `approveUrl`. */
export type CreatedLimitOrder = {
  /** The new limit order id, `mandate_` followed by a UUID. */
  id: string;
  /** The PayPal page where the human approves the hold. Only a human can do this. */
  approveUrl: string;
  /** The shortlisted items the human signs for, at most 3. */
  candidates: Candidate[];
  /** Items the shortlist turned down, with reasons. */
  rejected: Rejected[];
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

const createdLimitOrderProperties: s.Shape<CreatedLimitOrder> = {
  id: s.string(),
  approveUrl: s.string(),
  candidates: s.array(s.lazy(() => candidateInternalSchema)),
  rejected: s.array(s.lazy(() => rejectedSchema)),
};

export const createdLimitOrderInternalSchema: Schema<CreatedLimitOrder> = s.object<CreatedLimitOrder>(
  createdLimitOrderProperties,
  { additionalProperties: s.json() },
);

export const createdLimitOrderSchema: Schema<CreatedLimitOrder> = s.lazySchema(() =>
  s.object<CreatedLimitOrder>(
    {
      ...createdLimitOrderProperties,
      approveUrl: s.string().check(s.url()),
      candidates: s.array(s.lazy(() => candidateSchema)),
    },
    { additionalProperties: s.json() },
  ),
);
