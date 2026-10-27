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
    | "hold_renewed"
    | "ship_to_refused"
    | "closed";
  message: string;
  data?: Record<string, string>;
};
