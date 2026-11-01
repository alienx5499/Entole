// Schedule changes are audit entries (`agent_step` with `data.schedule`), so the proposal, the
// buyer's answer and who made it survive a restart and read back in the order's history.
export type ScheduleStep = "proposed" | "accepted" | "rejected";

// Who proposed: an AI client's token, the buyer's "Ask the watcher" button (the watcher picks
// the time), or the watcher on its own during a tick.
export type ProposedBy = "ai_client" | "watcher" | "auto";

// What a schedule change writes into its audit entry's data. `at` is an ISO time.
export type ScheduleStepData = {
  schedule: ScheduleStep;
  at?: string;
  reason?: string;
  by?: ProposedBy;
};

const STEPS: readonly string[] = ["proposed", "accepted", "rejected"] satisfies ScheduleStep[];

/** The schedule change an audit entry records, or null when it records something else. */
export const scheduleStepOf = (e: {
  kind: string;
  data?: Record<string, string>;
}): ScheduleStepData | null =>
  e.kind === "agent_step" && e.data && STEPS.includes(e.data.schedule ?? "")
    ? (e.data as ScheduleStepData)
    : null;
