import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

/**
 * Where the buyer's PayPal account says to ship, read from the approved order; null when the
 * approval carried no address. Entole does not place the shop order in this demo.
 */
export type ShipTo = {
  /** The recipient's full name. */
  name: string;
  /** The street address lines. */
  lines: string[];
  /** The city. */
  city: string;
  /** The state or region code. */
  region: string;
  /** The postal code. */
  postalCode: string;
  /** The two-letter country code. */
  country: string;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const shipToSchema: Schema<ShipTo> = s.object<ShipTo>(
  {
    name: s.string(),
    lines: s.array(s.string()),
    city: s.string(),
    region: s.string(),
    postalCode: s.string(),
    country: s.string(),
  },
  { additionalProperties: s.json() },
);
