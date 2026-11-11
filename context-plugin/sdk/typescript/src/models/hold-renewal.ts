import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

/** Set once the watcher renewed the PayPal hold after its 3-day honor period; null otherwise. */
export type HoldRenewal = {
  /** When the hold was renewed. */
  at: Date;
  /** The new PayPal authorization id. */
  authorizationId: string;
  /** The PayPal authorization id it replaced. */
  previousAuthorizationId: string;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const holdRenewalSchema: Schema<HoldRenewal> = s.object<HoldRenewal>(
  {
    at: s.dateTime(),
    authorizationId: s.string(),
    previousAuthorizationId: s.string(),
  },
  { additionalProperties: s.json() },
);
