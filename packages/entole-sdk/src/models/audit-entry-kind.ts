import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** What kind of event an audit entry records. */
export const AuditEntryKind = {
  /** The order was drafted and its PayPal order created. */
  Created: "created",
  /** The human approved the hold in PayPal. */
  Funded: "funded",
  /** An agent or watcher step, such as a tool call or a proposed extra check. */
  AgentStep: "agent_step",
  /** A purchase passed the checks and was captured. */
  ProposalAllowed: "proposal_allowed",
  /** A proposed purchase failed the checks and nothing was paid. */
  ProposalBlocked: "proposal_blocked",
  /** PayPal did not complete a capture or a release. */
  CaptureFailed: "capture_failed",
  /** A verified PayPal webhook confirmation. */
  PaypalEvent: "paypal_event",
  /** The capture was refunded. */
  Refunded: "refunded",
  /** The PayPal hold was renewed after its honor period. */
  HoldRenewed: "hold_renewed",
  /** PayPal's shipping address check refused the address. */
  ShipToRefused: "ship_to_refused",
  /** The order closed and what was left of the hold was released. */
  Closed: "closed",
} as const;
export type AuditEntryKind = (typeof AuditEntryKind)[keyof typeof AuditEntryKind] | (string & {});

export const auditEntryKindSchema: EnumSchema<AuditEntryKind> = s.enumOf<AuditEntryKind>(AuditEntryKind);
