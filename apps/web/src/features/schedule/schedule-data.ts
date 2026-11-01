import type { AuditView, MandateOutcome, MandateView } from "@/shared/api";
import { OUTCOME_LABEL } from "@/shared/ui/outcome-label";

// The API's watcher runs every WATCH_INTERVAL_MIN minutes, 60 by default (apps/api/src/main.ts).
export const WATCH_INTERVAL_MIN = 60;

const MIN = 60_000;
const HOUR = 60 * MIN;

export type EventKind =
  | "hold"
  | "check"
  | "alert"
  | "update"
  | "blocked"
  | "capture"
  | "failed"
  | "release"
  | "closed"
  | "refund"
  | "renewal"
  | "next"
  | "proposal"
  | "planned";

/** One row per limit order. */
export type ScheduleResource = {
  id: string;
  name: string;
  limit: string;
  outcome: MandateOutcome;
  outcomeLabel: string;
  /** No check may be dragged past this: the API's limit (window end or PayPal hold expiry). */
  latestCheck: string;
};

/** A bar (the hold) or a zero-length milestone; dates are ISO strings. */
export type ScheduleEvent = {
  id: string;
  resourceId: string;
  name: string;
  detail: string;
  startDate: string;
  endDate: string;
  kind: EventKind;
  /** Only an agent's pending proposal may be dragged; everything else is history. */
  draggable: boolean;
};

/**
 * A band behind the row's events: the signed watch window, or, while a proposal waits, the zone
 * it may be dragged to (now to the API's limit).
 */
export type ScheduleWindow = {
  id: string;
  kind: "window" | "allowed";
  resourceId: string;
  name: string;
  startDate: string;
  endDate: string;
  outcome: MandateOutcome;
};

export type ScheduleData = {
  resources: ScheduleResource[];
  events: ScheduleEvent[];
  windows: ScheduleWindow[];
  span: { start: string; end: string };
};

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: string) => new Date(s).getTime();

// Audit kinds that become milestones, and the label each one gets. `created` and `funded` are
// the window and hold starts; `paypal_event` repeats a step already shown.
const MILESTONE: Partial<Record<AuditView["kind"], (e: AuditView) => [EventKind, string]>> = {
  agent_step: () => ["check", "Agent check"],
  proposal_blocked: () => ["blocked", "Blocked"],
  proposal_allowed: () => ["capture", "Captured"],
  capture_failed: () => ["failed", "Failed"],
  refunded: () => ["refund", "Refunded"],
  hold_renewed: () => ["renewal", "Hold renewed"],
  // A Channel3 event about the order that started no check (above the limit, out of stock).
  channel3_noted: () => ["update", "Price update"],
  closed: (e) => (Number(e.data?.voided ?? 0) > 0 ? ["release", "Released"] : ["closed", "Closed"]),
};

const CHECKS = new Set<AuditView["kind"]>(["agent_step", "proposal_blocked", "proposal_allowed"]);

// Schedule proposals and answers are `agent_step` entries tagged `data.schedule` (apps/api
// routes/schedule.ts). They are not checks, so they neither draw a check nor move the next one.
const isScheduleStep = (e: AuditView) => e.kind === "agent_step" && e.data?.schedule !== undefined;

/** The open proposal or the accepted extra check still ahead of now, from the latest schedule step. */
export function scheduleChange(m: MandateView, now: number) {
  if (m.outcome !== "watching") return null;
  const last = [...m.audit].reverse().find(isScheduleStep);
  const at = last?.data?.at;
  if (!last || !at || ms(at) <= now) return null;
  if (last.data?.schedule === "proposed")
    return {
      kind: "proposal" as const,
      at,
      reason: last.data.reason ?? "",
      // `by: "auto"`: the watcher proposed it during a check, with nobody asking.
      auto: last.data.by === "auto",
    };
  if (last.data?.schedule === "accepted") return { kind: "planned" as const, at, reason: "" };
  return null;
}

/**
 * When the watcher next looks at a watching order: one interval after its last check (or its
 * approval), stepped past `now`. The API's timer is not exposed, so this is the due time.
 */
export function nextCheckAt(m: MandateView, now: number, intervalMin = WATCH_INTERVAL_MIN) {
  if (m.outcome !== "watching") return null;
  const step = intervalMin * MIN;
  const anchors = m.audit
    .filter((e) => CHECKS.has(e.kind) && !isScheduleStep(e))
    .map((e) => ms(e.at));
  const approved = m.receipt.times.approved;
  if (approved) anchors.push(ms(approved));
  if (anchors.length === 0) anchors.push(ms(m.createdAt));
  let next = Math.max(...anchors) + step;
  if (next <= now) next += Math.ceil((now - next) / step + 1e-9) * step;
  return next;
}

// The hold runs from approval to whichever ended it; a watching hold runs to the window's end,
// when the watcher releases it. PayPal keeps an authorization 29 days, but the window is at most 3.
function holdEnd(m: MandateView): number {
  const t = m.receipt.times;
  const closed = m.audit.find((e) => e.kind === "closed")?.at;
  const end = t.released ?? t.captured ?? closed ?? m.validUntil;
  return ms(end);
}

const usd = (s: string) => `$${s}`;

const WINDOW_NOTE: Partial<Record<MandateOutcome, string>> = {
  expired: "Never approved",
  cancelled: "Cancelled before approval",
};

// A Channel3 webhook wake is an `agent_step` with `data.eventId`; once its check finishes on Render
// a second entry carries the same event id and `data.taskRunId`. The two read as one price alert.
const isRun = (e: AuditView) => e.data?.taskRunId !== undefined;

function alertDetail(e: AuditView, runs: Map<string, string>): string {
  if (isRun(e)) return e.message;
  const run = runs.get(e.data?.eventId ?? "");
  const price = e.data?.price ? ` Reported price ${usd(e.data.price)}.` : "";
  return `${e.message}.${price}${run ? ` Render run ${run}` : ""}`;
}

export function toSchedule(m: MandateView, now: number): Omit<ScheduleData, "span"> {
  const resource: ScheduleResource = {
    id: m.id,
    name: m.terms.query,
    limit: m.terms.limitPrice,
    outcome: m.outcome,
    outcomeLabel: OUTCOME_LABEL[m.outcome],
    latestCheck: m.latestCheckAt,
  };
  const window: ScheduleWindow = {
    id: `${m.id}:window`,
    kind: "window",
    resourceId: m.id,
    // The legend names the band; only a window that never held money says why.
    name: WINDOW_NOTE[m.outcome] ?? "",
    startDate: m.createdAt,
    endDate: m.validUntil,
    outcome: m.outcome,
  };
  const events: ScheduleEvent[] = [];
  const approved = m.receipt.times.approved;
  if (approved) {
    const start = ms(approved);
    // A hold that ended within minutes still reads as a bar, not a milestone.
    const end = Math.max(holdEnd(m), start + 5 * MIN);
    events.push({
      id: `${m.id}:hold`,
      resourceId: m.id,
      name: `PayPal hold ${usd(m.receipt.amounts.held)}`,
      detail: m.outcome === "watching" ? "Released at the window's end if nothing buys" : "",
      startDate: iso(start),
      endDate: iso(end),
      kind: "hold",
      draggable: false,
    });
  }
  const runs = new Map<string, string>();
  const wakes = new Set<string>();
  for (const e of m.audit) {
    const eventId = e.data?.eventId;
    if (e.kind !== "agent_step" || !eventId) continue;
    if (isRun(e)) runs.set(eventId, e.data?.taskRunId ?? "");
    else wakes.add(eventId);
  }
  m.audit.forEach((e, i) => {
    const label = isScheduleStep(e) ? undefined : MILESTONE[e.kind]?.(e);
    if (!label) return;
    const eventId = e.kind === "agent_step" ? e.data?.eventId : undefined;
    // A run entry is folded into its wake's tooltip; drawn alone only if the wake is missing.
    if (eventId && isRun(e) && wakes.has(eventId)) return;
    const [kind, name] = eventId ? (["alert", "Price alert"] as const) : label;
    // A capture that kept nothing back closes with nothing to release; the capture says it all.
    if (kind === "closed" && m.captured !== "0.00") return;
    events.push({
      id: `${m.id}:a${i}`,
      resourceId: m.id,
      name: kind === "capture" ? `Captured ${usd(m.captured)}` : name,
      detail: kind === "alert" ? alertDetail(e, runs) : e.message,
      startDate: e.at,
      endDate: e.at,
      kind,
      draggable: false,
    });
  });
  const next = nextCheckAt(m, now);
  if (next !== null) {
    events.push({
      id: `${m.id}:next`,
      resourceId: m.id,
      name: "Next check",
      detail: `The watcher checks every ${WATCH_INTERVAL_MIN} minutes`,
      startDate: iso(next),
      endDate: iso(next),
      kind: "next",
      draggable: false,
    });
  }
  const windows = [window];
  const change = scheduleChange(m, now);
  if (change?.kind === "proposal")
    windows.push({
      id: `${m.id}:allowed`,
      kind: "allowed",
      resourceId: m.id,
      name: "You can move it here",
      startDate: iso(now),
      endDate: m.latestCheckAt,
      outcome: m.outcome,
    });
  if (change) {
    const proposal = change.kind === "proposal";
    const auto = proposal && change.auto;
    events.push({
      id: `${m.id}:${change.kind}`,
      resourceId: m.id,
      name: auto ? "Watcher proposal" : proposal ? "Proposed check" : "Extra check",
      detail: proposal
        ? `${auto ? "The watcher proposed this on its own. " : ""}${change.reason}. Drag it within the window, then accept or reject`
        : "You accepted this extra check",
      startDate: change.at,
      endDate: change.at,
      kind: change.kind,
      draggable: proposal,
    });
  }
  return { resources: [resource], events, windows };
}

/** Every order on one time axis, padded so the first and last marks are not on the edge. */
export function buildSchedule(views: MandateView[], now: number): ScheduleData {
  const parts = views.map((v) => toSchedule(v, now));
  const resources = parts.flatMap((p) => p.resources);
  const events = parts.flatMap((p) => p.events);
  const windows = parts.flatMap((p) => p.windows);
  const times = [now, ...windows.flatMap((w) => [ms(w.startDate), ms(w.endDate)])];
  for (const e of events) times.push(ms(e.startDate), ms(e.endDate));
  return {
    resources,
    events,
    windows,
    span: { start: iso(Math.min(...times) - 6 * HOUR), end: iso(Math.max(...times) + 6 * HOUR) },
  };
}

export type Zoom = "day" | "3days" | "week";

const ZOOM_HOURS: Record<Zoom, number> = { day: 24, "3days": 72, week: 168 };

/** The visible range for a zoom preset: two thirds behind now, where the history is. */
export function zoomRange(zoom: Zoom, now: number) {
  const span = ZOOM_HOURS[zoom] * HOUR;
  return { start: new Date(now - (span * 2) / 3), end: new Date(now + span / 3) };
}
