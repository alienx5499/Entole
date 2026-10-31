"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getMandate, listMandateViews } from "@/shared/api";
import { CurveLoader } from "@/shared/ui";
import { ProposalBar } from "./ProposalBar";
import s from "./schedule.module.css";
import { buildSchedule, type ScheduleData, WATCH_INTERVAL_MIN, type Zoom } from "./schedule-data";

// Bryntum touches `window` on import, so it loads in the browser only.
const ScheduleView = dynamic(() => import("./ScheduleView"), {
  ssr: false,
  // Holds the board's place and centres the loader where the timeline will appear.
  loading: () => (
    <div className={s.boardLoading}>
      <CurveLoader size="inline" title="Drawing the schedule" />
    </div>
  ),
});

const POLL_MS = 45_000;

const ZOOMS: { id: Zoom; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "3days", label: "3 days" },
  { id: "week", label: "Week" },
];

const LEGEND = [
  ["window", "Watch window"],
  ["hold", "PayPal hold"],
  ["check", "Agent check"],
  ["alert", "Price alert"],
  ["blocked", "Blocked by a check"],
  ["capture", "Captured"],
  ["release", "Released"],
  ["refund", "Refunded"],
  ["renewal", "Hold renewed"],
  ["next", "Next check"],
  ["proposal", "Agent proposal"],
  ["planned", "Extra check"],
] as const;

// One order's timeline when `order` is set, else every order.
async function loadSchedule(order?: string): Promise<ScheduleData> {
  const views = order ? [await getMandate(order)] : await listMandateViews();
  return buildSchedule(views, Date.now());
}

/** Every limit order (or one) on one time axis, refreshed while the tab is visible. */
export function Schedule({ order }: { order?: string }) {
  const [data, setData] = useState<ScheduleData | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState<Zoom>("3days");
  const [updated, setUpdated] = useState<Date | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const onMove = useCallback(
    (id: string, at: string) => setDrafts((d) => ({ ...d, [id]: at })),
    [],
  );

  const refresh = useCallback(
    () =>
      loadSchedule(order)
        .then((d) => {
          setData(d);
          setFailed(false);
          setUpdated(new Date());
        })
        // A failed poll keeps the last schedule on screen; only a first load shows the error.
        .catch(() => setFailed(true)),
    [order],
  );
  // An answered proposal drops the buyer's dragged time with it.
  const onChanged = useCallback(() => {
    setDrafts({});
    return refresh();
  }, [refresh]);

  // The watcher keeps working while nobody looks, so the board polls only when the tab is visible
  // and catches up the moment it is shown again.
  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const onShow = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [refresh]);

  if (failed && !data) return <p role="alert">Could not load your schedule. Reload to retry.</p>;
  if (!data) return <CurveLoader title="Loading your schedule" subtitle="Reading every order" />;

  return (
    <section className={s.wrap} aria-labelledby="schedule-title">
      <div className={s.head}>
        <h1 id="schedule-title">{order ? "Order schedule" : "Schedule"}</h1>
        {data.resources.length > 0 && (
          <fieldset className={s.zoom}>
            <legend className={s.hidden}>Zoom</legend>
            {ZOOMS.map((z) => (
              <button
                key={z.id}
                type="button"
                className="chip"
                aria-pressed={zoom === z.id}
                onClick={() => setZoom(z.id)}
              >
                {z.label}
              </button>
            ))}
          </fieldset>
        )}
      </div>
      <p className={s.lede}>
        The watcher checks each open order every {WATCH_INTERVAL_MIN} minutes and drives this board:
        every check, price alert, capture and release lands here within {POLL_MS / 1000} seconds.
        {updated && (
          <span className={s.updated}>
            {" "}
            Updated {updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {failed && ", last refresh failed"}.
          </span>
        )}
      </p>
      {data.resources.length === 0 ? (
        <p className="card">
          No limit orders yet. <Link href="/mandates/new">Set a price</Link> and its watch window,
          hold and checks appear here.
        </p>
      ) : (
        <>
          <ul className={s.legend} aria-label="Legend">
            {LEGEND.map(([kind, label]) => (
              <li key={kind}>
                <span className={`${s.swatch} ${s[kind]}`} aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
          <ProposalBar data={data} drafts={drafts} onChanged={onChanged} />
          <ScheduleView data={data} zoom={zoom} drafts={drafts} onMove={onMove} />
          <p className={s.hint}>
            Click any mark to open that order. Drag an agent proposal along its row to pick your own
            time inside the shaded zone; it cannot go past the window you signed or the PayPal hold.
            {order && (
              <>
                {" "}
                <Link href="/schedule">Show every order</Link>.
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}
