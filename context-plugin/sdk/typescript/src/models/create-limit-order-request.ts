import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";

/** The terms of a new limit order, as the human will sign them in PayPal. */
export type CreateLimitOrderRequest = {
  /** What to buy; 1 to 200 characters after trimming. */
  query: string;
  /** Brands the item must be from; empty or absent means any brand. */
  brands?: string[];
  /** Words that rule an item out when its listing contains them. */
  avoid?: string[];
  /** Keys and values of 1 to 60 characters. */
  requiredAttributes?: Record<string, string>;
  /** The most to pay, from "1.00" to "5000.00" inclusive. It is also the PayPal hold. */
  limitPrice: string;
  /** How long the order watches prices. Past 3 days the hold is renewed once. */
  validDays: number;
  /** Plant a labelled fake listing for the prompt-injection demo. @default false */
  demoInjection?: boolean;
  /**
   * Buy at recorded history prices instead of live ones; part of the signed digest.
   *
   * @default false
   */
  replay?: boolean;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

const createLimitOrderRequestProperties: s.Shape<CreateLimitOrderRequest> = {
  query: s.string(),
  brands: s.optional(s.array(s.string())),
  avoid: s.optional(s.array(s.string())),
  requiredAttributes: s.optional(s.record(s.string(), s.string())),
  limitPrice: s.string(),
  validDays: s.int(),
  demoInjection: s.defaulted(s.boolean(), false),
  replay: s.defaulted(s.boolean(), false),
};

export const createLimitOrderRequestInternalSchema: Schema<CreateLimitOrderRequest> =
  s.object<CreateLimitOrderRequest>(createLimitOrderRequestProperties, { additionalProperties: s.json() });

export const createLimitOrderRequestSchema: Schema<CreateLimitOrderRequest> = s.lazySchema(() =>
  s.object<CreateLimitOrderRequest>(
    {
      ...createLimitOrderRequestProperties,
      query: s.string().check(s.minLength(1), s.maxLength(200)),
      brands: s.optional(s.array(s.string().check(s.minLength(1), s.maxLength(60))).check(s.maxLength(10))),
      avoid: s.optional(s.array(s.string().check(s.minLength(1), s.maxLength(60))).check(s.maxLength(10))),
      requiredAttributes: s.optional(s.record(s.string(), s.string()).check(s.maxProperties(10))),
      limitPrice: s.string().check(s.pattern("^\\d{1,7}(\\.\\d{1,2})?$")),
      validDays: s.int().check(s.gte(1), s.lte(29)),
    },
    { additionalProperties: s.json() },
  ),
);
