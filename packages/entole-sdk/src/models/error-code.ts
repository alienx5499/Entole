import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/**
 * A fixed error code; upstream messages and stacks are never returned. The HTTP status and the
 * operation's response descriptions say which codes an operation can return.
 */
export const ErrorCode = {
  /** The request body is not valid JSON. */
  InvalidJson: "invalid_json",
  /** One request field is missing or out of range; `field` names it. */
  InvalidField: "invalid_field",
  /** The request breaks a domain rule the field checks do not cover. */
  InvalidRequest: "invalid_request",
  /** The bearer token is missing, unknown or revoked. */
  Unauthorized: "unauthorized",
  /** The order belongs to another user. */
  Forbidden: "forbidden",
  /** No order has that id. */
  NotFound: "not_found",
  /** The path exists but not with this HTTP method. */
  MethodNotAllowed: "method_not_allowed",
  /** The order is not a funded limit order, so no check can be proposed. */
  NotWatching: "not_watching",
  /** No item fits the terms; `rejected` says why. */
  NoCandidates: "no_candidates",
  /** The proposed check time is not after now. */
  CheckInPast: "check_in_past",
  /** The proposed check time is after the order's window or the PayPal hold's expiry. */
  PastValidUntil: "past_valid_until",
  /** Too many calls in the current window; send again after `Retry-After` seconds. */
  RateLimited: "rate_limited",
  /** The user created 30 orders today. */
  DailyLimitReached: "daily_limit_reached",
  /** All users together created 500 orders today. */
  ServiceDailyLimitReached: "service_daily_limit_reached",
  /** The model provider is rate limiting Entole. */
  UpstreamRateLimited: "upstream_rate_limited",
  /** An unexpected server error. */
  InternalError: "internal_error",
  /** PayPal, Channel3 or the model failed. */
  UpstreamError: "upstream_error",
  /** The PayPal void failed 3 times; what is left of the hold was not released. */
  ReleaseFailed: "release_failed",
  /** The Idempotency-Key is not 1 to 255 printable ASCII characters without spaces. */
  InvalidIdempotencyKey: "invalid_idempotency_key",
  /** The Idempotency-Key was already used with another body or route. */
  IdempotencyKeyReused: "idempotency_key_reused",
  /**
   * A request with this Idempotency-Key is still running; send again after `Retry-After` seconds.
   */
  IdempotencyInProgress: "idempotency_in_progress",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode] | (string & {});

export const errorCodeSchema: EnumSchema<ErrorCode> = s.enumOf<ErrorCode>(ErrorCode);
