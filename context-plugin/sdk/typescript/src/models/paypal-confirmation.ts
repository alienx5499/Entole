import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

/** A PayPal webhook confirmation, verified before it was written. */
export type PaypalConfirmation = {
  /** When Entole recorded the event. */
  at: Date;
  /** The PayPal webhook event type. */
  eventType: string;
  /** What the event means, in words for people. */
  message: string;
  /** The PayPal webhook event id. */
  eventId: string;
};

export const paypalConfirmationSchema: Schema<PaypalConfirmation> = s.object<PaypalConfirmation>({
  at: s.dateTime(),
  eventType: s.string(),
  message: s.string(),
  eventId: s.string(),
});
