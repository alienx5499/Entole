import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/** The AP2 `cnf` claim. Always `{}`: Entole holds no agent key, so `kid` is never set. */
export type Ap2Confirmation = {
  /** The id of the agent's confirmation key; never set by Entole. */
  kid?: string;
};

export const ap2ConfirmationSchema: Schema<Ap2Confirmation> = s.object<Ap2Confirmation>({
  kid: s.optional(s.string()),
});
