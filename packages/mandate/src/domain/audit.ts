export const AUDIT_KINDS = [
  "created",
  "funded",
  "agent_step",
  "proposal_allowed",
  "proposal_blocked",
  "capture_failed",
  "paypal_event",
  "refunded",
  "hold_renewed",
  "ship_to_refused",
  "channel3_noted",
  "closed",
] as const;

export type AuditEntry = {
  at: Date;
  kind: (typeof AUDIT_KINDS)[number];
  message: string;
  data?: Record<string, string>;
};
