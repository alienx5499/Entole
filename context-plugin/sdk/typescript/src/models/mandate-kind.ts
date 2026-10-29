import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** The order type; orders created through this API are always `limit`. */
export const MandateKind = {
  /** A one-off purchase within a 3-day window. */
  Standard: "standard",
  /** A watched order that buys once at or under the limit price, for up to 29 days. */
  Limit: "limit",
} as const;
export type MandateKind = (typeof MandateKind)[keyof typeof MandateKind] | (string & {});

export const mandateKindSchema: EnumSchema<MandateKind> = s.enumOf<MandateKind>(MandateKind);
