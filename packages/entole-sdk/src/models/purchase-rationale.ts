import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { skippedCandidateSchema, type SkippedCandidate } from "./skipped-candidate.js";

/**
 * Why this item was bought, built from the deterministic check details in the audit trail, never
 * from model prose.
 */
export type PurchaseRationale = {
  /** The bought item, its price and the limit it met. */
  chosen: string;
  /** The other signed candidates and why each was not bought. */
  skipped: SkippedCandidate[];
};

export const purchaseRationaleSchema: Schema<PurchaseRationale> = s.object<PurchaseRationale>({
  chosen: s.string(),
  skipped: s.array(s.lazy(() => skippedCandidateSchema)),
});
