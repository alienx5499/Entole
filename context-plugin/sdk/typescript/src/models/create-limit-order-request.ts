import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

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
};

export const createLimitOrderRequestSchema: Schema<CreateLimitOrderRequest> =
  s.object<CreateLimitOrderRequest>({
    query: s.string(),
    brands: s.optional(s.array(s.string())),
    avoid: s.optional(s.array(s.string())),
    requiredAttributes: s.optional(s.record(s.string(), s.string())),
    limitPrice: s.string(),
    validDays: s.int(),
    demoInjection: s.defaulted(s.boolean(), false),
    replay: s.defaulted(s.boolean(), false),
  });
