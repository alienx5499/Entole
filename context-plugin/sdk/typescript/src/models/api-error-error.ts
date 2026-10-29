import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { errorCodeSchema, type ErrorCode } from "./error-code.js";
import { rejectedSchema, type Rejected } from "./rejected.js";

/** The body of every error response. */
export type ApiErrorError = {
  /**
   * A fixed error code; upstream messages and stacks are never returned. The HTTP status and the
   * operation's response descriptions say which codes an operation can return.
   */
  error: ErrorCode;
  /** The rejected request field, set with `invalid_field`. */
  field?: string;
  /** Set with `no_candidates`. */
  rejected?: Rejected[];
};

export const apiErrorErrorSchema: Schema<ApiErrorError> = s.object<ApiErrorError>({
  error: errorCodeSchema,
  field: s.optional(s.string()),
  rejected: s.optional(s.array(s.lazy(() => rejectedSchema))),
});
