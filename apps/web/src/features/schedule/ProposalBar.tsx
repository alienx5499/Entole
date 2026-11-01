"use client";

import { useState } from "react";
import { ApiError, decideCheck, proposeCheck } from "@/shared/api";
import s from "./schedule.module.css";
import type { ScheduleData } from "./schedule-data";

type Props = {
  data: ScheduleData;
  drafts: Record<string, string>;
  /** Called after any change so the board reloads from the API. */
  onChanged: () => void;
};

// Only rendered after the schedule is fetched in the browser, so the server never formats a time;
// the locale and zone are the browser's own, as before, just named.
const LOCAL = Intl.DateTimeFormat().resolvedOptions();
const TIME = new Intl.DateTimeFormat(LOCAL.locale, {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: LOCAL.timeZone,
});
const time = (iso: string) => TIME.format(new Date(iso));

const ERRORS: Record<string, string> = {
  past_valid_until: "That time is past the window you signed",
  check_in_past: "That time has already passed, drag it later",
  no_pending_proposal: "This proposal was already answered",
  not_watching: "This order is no longer being watched",
};

/**
 * The buyer's side of an agent-driven schedule: each open proposal with Accept and Reject, and,
 * for a watched order without one, a button that asks the watcher to propose a check time.
 */
export function ProposalBar({ data, drafts, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const proposals = data.events.filter((e) => e.kind === "proposal");
  const asked = new Set(proposals.map((p) => p.resourceId));
  const askable = data.resources.filter((r) => r.outcome === "watching" && !asked.has(r.id));
  if (proposals.length === 0 && askable.length === 0) return null;

  const run = (id: string, call: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    call()
      .then(onChanged)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? (ERRORS[e.error] ?? e.error) : "Something went wrong"),
      )
      .finally(() => setBusy(null));
  };

  const nameOf = (id: string) => data.resources.find((r) => r.id === id)?.name ?? "Order";

  return (
    <section className={s.proposals} aria-label="Schedule proposals">
      {proposals.map((p) => {
        const at = drafts[p.resourceId] ?? p.startDate;
        const moved = at !== p.startDate;
        return (
          <div key={p.id} className={s.offer}>
            <p>
              <b>{nameOf(p.resourceId)}</b>: the agent proposes an extra price check at{" "}
              <b>{time(at)}</b>
              {moved && " (your time)"}. <span className={s.reason}>{p.detail}.</span>
            </p>
            <div className={s.actions}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={() => run(p.resourceId, () => decideCheck(p.resourceId, true, at))}
              >
                Accept
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy !== null}
                onClick={() => run(p.resourceId, () => decideCheck(p.resourceId, false))}
              >
                Reject
              </button>
            </div>
          </div>
        );
      })}
      {askable.map((r) => (
        <div key={r.id} className={s.offer}>
          <p>
            <b>{r.name}</b>: let the watcher pick a time for one extra check, based on how close the
            price is to your limit.
          </p>
          <button
            type="button"
            className="chip"
            disabled={busy !== null}
            onClick={() => run(r.id, () => proposeCheck(r.id))}
          >
            {busy === r.id ? "Asking" : "Ask the watcher"}
          </button>
        </div>
      ))}
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
