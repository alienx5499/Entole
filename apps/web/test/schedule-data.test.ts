/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  buildSchedule,
  nextCheckAt,
  scheduleChange,
  toSchedule,
  zoomRange,
} from "../src/features/schedule/schedule-data";
import type { AuditView, MandateView } from "../src/shared/api/types";

const NOW = Date.parse("2026-10-21T12:30:00.000Z");
type Times = MandateView["receipt"]["times"];
const times: Times = { approved: null, captured: null, released: null, refunded: null };

const view = (over: Partial<MandateView> & { times?: Partial<Times> }): MandateView =>
  ({
    id: "m1",
    outcome: "watching",
    createdAt: "2026-10-21T09:00:00.000Z",
    validUntil: "2026-10-24T09:00:00.000Z",
    terms: { query: "trail shoes", limitPrice: "80.00" },
    captured: "0.00",
    audit: [],
    ...over,
    receipt: {
      amounts: { held: "80.00", captured: "0.00", released: "0.00", refunded: "0.00" },
      times: { ...times, ...over.times },
    },
  }) as unknown as MandateView;

const step = (kind: AuditView["kind"], at: string, data?: Record<string, string>): AuditView => ({
  kind,
  at,
  message: `${kind} message`,
  data,
});

const kinds = (m: MandateView) => toSchedule(m, NOW).events.map((e) => e.kind);

describe("schedule mapping", () => {
  test("a watching order: hold to the window's end, checks as milestones, a next check", () => {
    const m = view({
      times: { approved: "2026-10-21T09:05:00.000Z" },
      audit: [
        step("created", "2026-10-21T09:00:00.000Z"),
        step("funded", "2026-10-21T09:05:00.000Z"),
        step("agent_step", "2026-10-21T10:05:00.000Z"),
        step("proposal_blocked", "2026-10-21T11:05:00.000Z"),
      ],
    });
    const s = toSchedule(m, NOW);
    expect(s.resources[0]).toMatchObject({
      id: "m1",
      name: "trail shoes",
      outcomeLabel: "Watching",
    });
    expect(s.windows[0]).toMatchObject({ startDate: m.createdAt, endDate: m.validUntil });
    const hold = s.events.find((e) => e.kind === "hold");
    expect(hold).toMatchObject({ name: "PayPal hold $80.00", endDate: m.validUntil });
    expect(kinds(m)).toEqual(["hold", "check", "blocked", "next"]);
    // Last check 11:05, so the next is due 12:05; that is past at 12:30, so 13:05.
    expect(s.events.at(-1)?.startDate).toBe("2026-10-21T13:05:00.000Z");
  });

  test("next check steps from approval when no check has run, and skips closed orders", () => {
    const m = view({ times: { approved: "2026-10-21T12:00:00.000Z" } });
    expect(nextCheckAt(m, NOW)).toBe(Date.parse("2026-10-21T13:00:00.000Z"));
    expect(nextCheckAt(m, NOW, 15)).toBe(Date.parse("2026-10-21T12:45:00.000Z"));
    expect(nextCheckAt(view({ outcome: "released" }), NOW)).toBeNull();
  });

  test("a bought order: the hold ends at the release of the remainder", () => {
    const m = view({
      outcome: "bought",
      captured: "72.50",
      times: {
        approved: "2026-10-21T09:05:00.000Z",
        captured: "2026-10-21T11:00:00.000Z",
        released: "2026-10-21T11:00:02.000Z",
      },
      audit: [
        step("proposal_allowed", "2026-10-21T11:00:00.000Z"),
        step("closed", "2026-10-21T11:00:02.000Z", { voided: "7.50" }),
      ],
    });
    const s = toSchedule(m, NOW);
    expect(kinds(m)).toEqual(["hold", "capture", "release"]);
    expect(s.events[0]?.endDate).toBe("2026-10-21T11:00:02.000Z");
    expect(s.events[1]?.name).toBe("Captured $72.50");
  });

  test("a refunded order shows the capture and the refund", () => {
    const m = view({
      outcome: "refunded",
      captured: "80.00",
      times: { approved: "2026-10-21T09:05:00.000Z", captured: "2026-10-21T10:00:00.000Z" },
      audit: [
        step("proposal_allowed", "2026-10-21T10:00:00.000Z"),
        step("closed", "2026-10-21T10:00:01.000Z", { voided: "0.00" }),
        step("refunded", "2026-10-21T11:00:00.000Z"),
      ],
    });
    expect(kinds(m)).toEqual(["hold", "capture", "refund"]);
  });

  test("a cancelled order has no hold, only its close", () => {
    const m = view({
      outcome: "cancelled",
      audit: [step("closed", "2026-10-21T09:30:00.000Z", { voided: "0.00" })],
    });
    expect(kinds(m)).toEqual(["closed"]);
    expect(toSchedule(m, NOW).windows[0]?.name).toBe("Cancelled before approval");
  });

  test("an expired order is a window and nothing else", () => {
    const s = toSchedule(view({ outcome: "expired" }), NOW);
    expect(s.events).toEqual([]);
    expect(s.windows[0]?.name).toBe("Never approved");
  });

  test("a released hold that closed at once is still a bar", () => {
    const m = view({
      outcome: "released",
      times: { approved: "2026-10-21T09:05:00.000Z", released: "2026-10-21T09:05:30.000Z" },
      audit: [step("closed", "2026-10-21T09:05:30.000Z", { voided: "80.00" })],
    });
    const [hold] = toSchedule(m, NOW).events;
    expect(Date.parse(hold?.endDate ?? "") - Date.parse(hold?.startDate ?? "")).toBe(5 * 60_000);
  });

  test("the span covers every order and now, with padding", () => {
    const s = buildSchedule(
      [view({}), view({ id: "m2", validUntil: "2026-10-25T09:00:00.000Z" })],
      NOW,
    );
    expect(s.resources.map((r) => r.id)).toEqual(["m1", "m2"]);
    expect(s.span).toEqual({ start: "2026-10-21T03:00:00.000Z", end: "2026-10-25T15:00:00.000Z" });
    expect(buildSchedule([], NOW).resources).toEqual([]);
  });

  test("an agent proposal is the one draggable mark and does not count as a check", () => {
    const approved = "2026-10-21T12:00:00.000Z";
    const proposed = step("agent_step", "2026-10-21T12:20:00.000Z", {
      schedule: "proposed",
      at: "2026-10-21T12:45:00.000Z",
      reason: "Close to your limit",
    });
    const m = view({ times: { approved }, audit: [proposed] });
    const s = toSchedule(m, NOW);
    expect(kinds(m)).toEqual(["hold", "next", "proposal"]);
    expect(s.events.filter((e) => e.draggable).map((e) => e.kind)).toEqual(["proposal"]);
    expect(s.events.at(-1)).toMatchObject({ startDate: "2026-10-21T12:45:00.000Z" });
    // The proposal at 12:20 is not a check: the next one still steps from approval.
    expect(nextCheckAt(m, NOW)).toBe(Date.parse("2026-10-21T13:00:00.000Z"));
    expect(s.resources[0]?.validUntil).toBe(m.validUntil);
  });

  test("an accepted check is planned, a rejected or past one is gone", () => {
    const at = "2026-10-21T14:00:00.000Z";
    const answer = (schedule: string, when = at) =>
      view({
        audit: [
          step("agent_step", "2026-10-21T12:00:00.000Z", { schedule: "proposed", at: when }),
          step("agent_step", "2026-10-21T12:10:00.000Z", { schedule, at: when }),
        ],
      });
    expect(scheduleChange(answer("accepted"), NOW)).toEqual({ kind: "planned", at, reason: "" });
    expect(scheduleChange(answer("rejected"), NOW)).toBeNull();
    expect(scheduleChange(answer("accepted", "2026-10-21T12:15:00.000Z"), NOW)).toBeNull();
    expect(scheduleChange(view({ ...answer("accepted"), outcome: "bought" }), NOW)).toBeNull();
  });

  test("zoom shows two thirds of history before now", () => {
    const r = zoomRange("day", NOW);
    expect(r.end.getTime() - r.start.getTime()).toBe(24 * 3_600_000);
    expect(NOW - r.start.getTime()).toBe(16 * 3_600_000);
  });
});
