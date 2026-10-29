import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/** A signed candidate the watcher did not buy, with why. */
export type SkippedCandidate = {
  /** The candidate's title. */
  title: string;
  /** The last block reasons from the audit trail, or why it was never proposed. */
  reasons: string[];
};

export const skippedCandidateSchema: Schema<SkippedCandidate> = s.object<SkippedCandidate>({
  title: s.string(),
  reasons: s.array(s.string()),
});
