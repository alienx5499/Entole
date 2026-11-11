import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

/**
 * PayPal's own answer on the capture; each field is null on purchases made before it was recorded.
 */
export type PaypalCaptureResult = {
  /** The PayPal capture status, such as `COMPLETED` or `PENDING`. */
  status: string | null;
  /** PayPal's seller protection status for the capture. */
  sellerProtection: string | null;
  /** PayPal's fee as a decimal string in USD. */
  fee: string | null;
  /** What the payee received after the fee, as a decimal string in USD. */
  net: string | null;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const paypalCaptureResultSchema: Schema<PaypalCaptureResult> = s.object<PaypalCaptureResult>(
  {
    status: s.nullable(s.string()),
    sellerProtection: s.nullable(s.string()),
    fee: s.nullable(s.string()),
    net: s.nullable(s.string()),
  },
  { additionalProperties: s.json() },
);
