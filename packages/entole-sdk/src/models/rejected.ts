import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

/** An item the shortlist turned down, with the check's reasons. Not part of the signed digest. */
export type Rejected = {
  /** The listing's title. */
  title: string;
  /** The shop that listed it. */
  merchant: string;
  /** Why the check turned it down, one reason per entry. */
  details: string[];
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const rejectedSchema: Schema<Rejected> = s.object<Rejected>(
  {
    title: s.string(),
    merchant: s.string(),
    details: s.array(s.string()),
  },
  { additionalProperties: s.json() },
);
