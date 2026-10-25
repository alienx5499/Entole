export type AuditEntry = {
  at: Date;
  kind:
    | "created"
    | "funded"
    | "agent_step"
    | "proposal_allowed"
    | "proposal_blocked"
    | "capture_failed"
    | "paypal_event"
    | "refunded"
    | "closed";
  message: string;
  data?: Record<string, string>;
};
