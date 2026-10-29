import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/** Set once the watcher renewed the PayPal hold after its 3-day honor period; null otherwise. */
export type HoldRenewal = {
  /** When the hold was renewed. */
  at: Date;
  /** The new PayPal authorization id. */
  authorizationId: string;
  /** The PayPal authorization id it replaced. */
  previousAuthorizationId: string;
};

export const holdRenewalSchema: Schema<HoldRenewal> = s.object<HoldRenewal>({
  at: s.dateTime(),
  authorizationId: s.string(),
  previousAuthorizationId: s.string(),
});
