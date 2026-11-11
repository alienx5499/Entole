import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

/** One extra price check the agent proposes; both fields are optional. */
export type ProposeCheckRequest = {
  /** When to check; after now and no later than the window or the hold's expiry. */
  at?: Date;
  /** Shown to the human; trimmed and cut to 200 characters. */
  reason?: string;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const proposeCheckRequestSchema: Schema<ProposeCheckRequest> = s.object<ProposeCheckRequest>(
  {
    at: s.optional(s.dateTime()),
    reason: s.optional(s.string()),
  },
  { additionalProperties: s.json() },
);
