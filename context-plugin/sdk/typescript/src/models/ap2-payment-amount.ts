import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

/** The amount paid, in minor units. */
export type Ap2PaymentAmount = {
  /** The captured amount in cents. */
  amount: number;
  /** The ISO 4217 currency code. */
  currency: string;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const ap2PaymentAmountSchema: Schema<Ap2PaymentAmount> = s.object<Ap2PaymentAmount>(
  {
    amount: s.float64(),
    currency: s.string(),
  },
  { additionalProperties: s.json() },
);
