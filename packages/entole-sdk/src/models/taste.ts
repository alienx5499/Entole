import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

/**
 * Brands, avoids and attributes saved from the user's funded orders; null until one order was
 * funded.
 */
export type Taste = {
  /** Brands from the user's funded orders. */
  brands: string[];
  /** Words the user avoided in funded orders. */
  avoid: string[];
  /** Attributes the user required in funded orders, by name. */
  attributes: Record<string, string>;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const tasteSchema: Schema<Taste> = s.object<Taste>(
  {
    brands: s.array(s.string()),
    avoid: s.array(s.string()),
    attributes: s.record(s.string(), s.string()),
  },
  { additionalProperties: s.json() },
);
