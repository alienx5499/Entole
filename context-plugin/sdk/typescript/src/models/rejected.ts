import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/** An item the shortlist turned down, with the check's reasons. Not part of the signed digest. */
export type Rejected = {
  /** The listing's title. */
  title: string;
  /** The shop that listed it. */
  merchant: string;
  /** Why the check turned it down, one reason per entry. */
  details: string[];
};

export const rejectedSchema: Schema<Rejected> = s.object<Rejected>({
  title: s.string(),
  merchant: s.string(),
  details: s.array(s.string()),
});
