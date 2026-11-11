import * as s from "../core/validation/index.js";
import type { JsonValue, Schema } from "../core/validation/schema.js";
import { auditEntryKindSchema, type AuditEntryKind } from "./audit-entry-kind.js";

/** One entry of the order's append-only audit trail. */
export type AuditEntry = {
  /** When it happened. */
  at: Date;
  /** What kind of event an audit entry records. */
  kind: AuditEntryKind;
  /** What happened, in words for people. */
  message: string;
  /** Machine-readable details for the entry; keys depend on `kind`. */
  data?: Record<string, string>;
  /** Properties the service sent or accepts beyond those declared. */
  additionalProperties?: Record<string, JsonValue>;
};

export const auditEntrySchema: Schema<AuditEntry> = s.object<AuditEntry>(
  {
    at: s.dateTime(),
    kind: auditEntryKindSchema,
    message: s.string(),
    data: s.optional(s.record(s.string(), s.string())),
  },
  { additionalProperties: s.json() },
);
