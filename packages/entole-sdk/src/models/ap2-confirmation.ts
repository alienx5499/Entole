import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

/** The AP2 `cnf` claim. Always `{}`: Entole holds no agent key, so `kid` is never set. */
export type Ap2Confirmation = {
  /** The id of the agent's confirmation key; never set by Entole. */
  kid?: string;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const ap2ConfirmationSchema: Schema<Ap2Confirmation> = s.object<Ap2Confirmation>(
  {
    kid: s.optional(s.string()),
  },
  { additionalProperties: s.json() },
);
