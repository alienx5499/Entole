"use client";

import "@bryntum/scheduler/fontawesome/css/fontawesome.css";
import "@bryntum/scheduler/fontawesome/css/solid.css";
import "@bryntum/scheduler/scheduler.css";
import "@bryntum/scheduler/svalbard-light.css";
import { type EventModel, type Model, type ResourceModel, StringHelper } from "@bryntum/scheduler";
import { BryntumScheduler, type BryntumSchedulerProps } from "@bryntum/scheduler-react";
import { useRouter } from "next/navigation";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import s from "./schedule.module.css";
import { type EventKind, type ScheduleData, type Zoom, zoomRange } from "./schedule-data";

const enc = StringHelper.encodeHtml;

// The hold bar is unlabelled: hourly check diamonds sit on it and would cover its text. The
// legend names it and its tooltip carries the amount.
const LABELLED = new Set<EventKind>(["alert", "capture", "refund", "next", "proposal", "planned"]);

type TipData = { eventRecord: EventModel; startText: string; endText: string };

type DragContext = { startDate: Date; newResource: ResourceModel };

// History is fixed: only an agent's pending proposal is draggable (its record's `draggable`), along
// its own row, after now and no later than the API's limit (`latestCheckAt`: the signed window's
// end or the PayPal hold's expiry). The API checks it again on Accept: this is the hint, not the guard.
const withinWindow = ({ startDate, newResource }: DragContext) => {
  const until = new Date(newResource.get("latestCheck") as string);
  if (startDate.getTime() <= Date.now())
    return { valid: false, message: "Checks cannot be in the past" };
  if (startDate > until)
    return { valid: false, message: "Past the window you signed or the PayPal hold" };
  return { valid: true, message: "" };
};

const CONFIG: BryntumSchedulerProps = {
  eventDragFeature: { constrainDragToResource: true, validatorFn: withinWindow },
  eventResizeFeature: false,
  eventDragCreateFeature: false,
  eventEditFeature: false,
  eventCopyPasteFeature: false,
  cellEditFeature: false,
  enableDeleteKey: false,
  scheduleTooltipFeature: false,
  // Each order's life reads on one line: the checks sit on top of the hold bar.
  rowHeight: 48,
  barMargin: 8,
  eventLayout: "none",
  milestoneTextPosition: "always-outside",
  // The axis grows as the board is scrolled, so older orders stay reachable after a zoom.
  infiniteScroll: true,
  timeRangesFeature: { showCurrentTimeLine: { name: "Now" } },
  resourceTimeRangesFeature: true,
  eventTooltipFeature: {
    template: ({ eventRecord, startText, endText }: TipData) => {
      const detail = eventRecord.get("detail") as string;
      const when = eventRecord.isMilestone ? startText : `${startText} to ${endText}`;
      return `<b>${enc(eventRecord.name)}</b><br>${enc(when)}${detail ? `<br>${enc(detail)}` : ""}`;
    },
  },
  cellMenuFeature: false,
  eventMenuFeature: false,
  scheduleMenuFeature: false,
  headerMenuFeature: false,
  // Checks repeat hourly, so only the marks that change the order carry a label; the rest
  // show theirs in the tooltip.
  eventRenderer: ({ eventRecord }) =>
    LABELLED.has(eventRecord.get("kind") as EventKind) ? enc(eventRecord.name) : "",
  columns: [
    {
      text: "Limit order",
      field: "name",
      // A phone keeps most of its width for the time axis.
      width: typeof window !== "undefined" && window.innerWidth < 640 ? 150 : 260,
      renderer: ({ record: row }: { record: Model }) => {
        const record = row as ResourceModel;
        const outcome = record.get("outcome") as string;
        return `<div class="entole-order"><span class="entole-query">${enc(record.name)}</span>
          <span class="entole-meta">$${enc(record.get("limit") as string)}
          <span class="entole-tag entole-${enc(outcome)}">${enc(record.get("outcomeLabel") as string)}</span></span></div>`;
      },
    },
  ],
};

type Props = {
  data: ScheduleData;
  zoom: Zoom;
  /** Where the buyer has dragged each order's proposal, by order id. */
  drafts: Record<string, string>;
  onMove: (orderId: string, at: string) => void;
};

/** The Bryntum Scheduler itself; client-only, loaded by `Schedule` with SSR off. */
export default function ScheduleView({ data, zoom, drafts, onMove }: Props) {
  const ref = useRef<BryntumScheduler>(null);
  const router = useRouter();
  // Set once: a poll that moved the axis would undo the shopper's zoom and scroll, and
  // infinite scroll already reaches anything outside it.
  const [span] = useState(() => ({
    start: new Date(data.span.start),
    end: new Date(data.span.end),
  }));

  // A poll replaces the events; a dragged proposal keeps the buyer's time until they answer.
  const events = useMemo(
    () =>
      data.events.map((e) => {
        const at = e.kind === "proposal" ? drafts[e.resourceId] : undefined;
        return {
          ...e,
          resizable: false,
          cls: `entole-${e.kind}`,
          ...(at && { startDate: at, endDate: at }),
        };
      }),
    [data, drafts],
  );
  const windows = useMemo(
    () =>
      data.windows.map((w) => ({
        ...w,
        cls: w.kind === "allowed" ? "entole-allowed" : `entole-window entole-${w.outcome}`,
      })),
    [data],
  );

  // A zoom preset puts two thirds of its span behind now, where the checks already happened.
  useEffect(() => {
    const { start, end } = zoomRange(zoom, Date.now());
    ref.current?.instance.zoomToSpan({ startDate: start, endDate: end });
  }, [zoom]);

  return (
    <div className={s.board} style={{ "--rows": data.resources.length } as CSSProperties}>
      <BryntumScheduler
        ref={ref}
        {...CONFIG}
        startDate={span.start}
        endDate={span.end}
        resources={data.resources}
        events={events}
        resourceTimeRanges={windows}
        onEventClick={({ eventRecord }: { eventRecord: EventModel }) => {
          if (eventRecord.get("kind") === "proposal") return; // it is dragged, not opened
          router.push(`/mandates/${encodeURIComponent(String(eventRecord.resourceId))}`);
        }}
        onEventDrop={({ eventRecords }: { eventRecords: EventModel[] }) => {
          const [moved] = eventRecords;
          if (moved) onMove(String(moved.resourceId), (moved.startDate as Date).toISOString());
        }}
      />
    </div>
  );
}
