import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

/**
 * An AP2 merchant. As a payee it is always Entole, the account that receives the funds in this
 * sandbox demo; the shops are not paid.
 */
export type Ap2Merchant = {
  /** The merchant id; a shop's domain, or `entole` for the payee. */
  id: string;
  /** The merchant's display name. */
  name: string;
  /** The shop's website; set only when the id is a domain. */
  website?: string;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

const ap2MerchantProperties: s.Shape<Ap2Merchant> = {
  id: s.string(),
  name: s.string(),
  website: s.optional(s.string()),
};

export const ap2MerchantInternalSchema: Schema<Ap2Merchant> = s.object<Ap2Merchant>(ap2MerchantProperties, {
  additionalProperties: s.json(),
});

export const ap2MerchantSchema: Schema<Ap2Merchant> = s.lazySchema(() =>
  s.object<Ap2Merchant>(
    {
      ...ap2MerchantProperties,
      website: s.optional(s.string().check(s.url())),
    },
    { additionalProperties: s.json() },
  ),
);
