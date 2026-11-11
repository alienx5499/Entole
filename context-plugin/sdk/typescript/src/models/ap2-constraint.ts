import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

/**
 * One AP2 constraint, such as `checkout.allowed_merchants` or `payment.amount_range`. The other
 * fields depend on `type` and follow the AP2 JSON schemas.
 */
export type Ap2Constraint = {
  /** The AP2 constraint type. */
  type: string;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const ap2ConstraintSchema: Schema<Ap2Constraint> = s.object<Ap2Constraint>(
  {
    type: s.string(),
  },
  { additionalProperties: s.json() },
);
