import type { AuditEntry, MandateRepository } from "@entole/mandate/core";
import { type Clock, formatUsd, type Logger, type Money } from "@entole/shared-kernel";
import { NOTE_KIND, noteFacts, type OfferEvent } from "../domain/offer-event.ts";
import type { OfferNote } from "./mandates-to-wake.ts";

export type RecordWakesDeps = { repo: Pick<MandateRepository, "appendAudit">; clock: Clock };

export type RecordNotesDeps = {
  repo: Pick<MandateRepository, "appendAudit" | "recentNotes">;
  clock: Clock;
  logger: Logger;
};

// Shown on the mandate timeline and in the demo video; keep the wording.
const messageFor = (e: OfferEvent): string =>
  e.kind === "availability"
    ? `Channel3 reported ${e.domain} back in stock, checking now`
    : `Channel3 reported a price change at ${e.domain}, checking now`;

// One timeline entry per mandate whose check was started for this event.
export const recordWakes = async (
  deps: RecordWakesDeps,
  ids: string[],
  e: OfferEvent,
): Promise<void> => {
  for (const id of ids)
    await deps.repo.appendAudit(id, {
      at: deps.clock.now(),
      kind: "agent_step",
      message: messageFor(e),
      data: {
        eventId: e.id,
        productId: e.productId,
        domain: e.domain,
        ...(e.price ? { price: formatUsd(e.price) } : {}),
      },
    });
};

const dollars = (m: Money) => `$${formatUsd(m)}`;

// Shown on the mandate timeline and the schedule; no check, Render run or PayPal call follows.
const noteMessage = (n: OfferNote, e: OfferEvent): string => {
  const price = e.price ? dollars(e.price) : "";
  const limit = `above your ${dollars(n.limit)} limit. Still waiting.`;
  switch (n.reason) {
    case "out_of_stock":
      return `Channel3 reported ${e.domain} is no longer listed as in stock. Still waiting.`;
    case "new_offer_above_limit":
      return `Channel3 reported a new offer at ${e.domain}: ${price}, ${limit}`;
    case "above_limit": {
      const was = e.previousPrice ? ` (was ${dollars(e.previousPrice)})` : "";
      return `Channel3 reported a price change at ${e.domain}: ${price}${was}, ${limit}`;
    }
  }
};

// Channel3 can resend the same price for hours; one note per price per order is enough.
const REPEAT_MS = 6 * 60 * 60 * 1000;

const sameNews = (a: AuditEntry, facts: Record<string, string>): boolean =>
  a.data?.productId === facts.productId &&
  a.data?.domain?.toLowerCase() === facts.domain?.toLowerCase() &&
  a.data?.price === facts.price &&
  a.data?.availability === facts.availability;

// Best effort: a repeat check that cannot read writes the notes anyway, since a doubled note is
// harmless and a missing one hides the webhook.
const recentNotes = (deps: RecordNotesDeps, ids: string[]) =>
  deps.repo
    .recentNotes(ids, new Date(deps.clock.now().getTime() - REPEAT_MS))
    .catch((err: unknown) => {
      deps.logger.error("channel3 note repeat check failed:", (err as Error).message);
      return new Map<string, AuditEntry[]>();
    });

// One timeline entry per order the event was about but did not wake, unless the order already has
// the same news from the last 6 hours. Returns the ids it wrote to.
export const recordNotes = async (
  deps: RecordNotesDeps,
  notes: OfferNote[],
  e: OfferEvent,
): Promise<string[]> => {
  if (notes.length === 0) return [];
  const facts = noteFacts(e);
  const recent = await recentNotes(
    deps,
    notes.map((n) => n.mandateId),
  );
  const written: string[] = [];
  for (const n of notes) {
    if ((recent.get(n.mandateId) ?? []).some((a) => sameNews(a, facts))) continue;
    await deps.repo.appendAudit(n.mandateId, {
      at: deps.clock.now(),
      kind: NOTE_KIND,
      message: noteMessage(n, e),
      data: {
        eventId: e.id,
        ...facts,
        ...(e.previousPrice ? { previousPrice: formatUsd(e.previousPrice) } : {}),
      },
    });
    written.push(n.mandateId);
  }
  return written;
};

// The Render run that finished the check an event started, so the schedule and the Render
// dashboard point at the same run. Written after the check, beside its wake entry.
export const recordCheckRun = (
  deps: RecordWakesDeps,
  id: string,
  run: { eventId: string; taskRunId: string },
): Promise<void> =>
  deps.repo.appendAudit(id, {
    at: deps.clock.now(),
    kind: "agent_step",
    message: `Render run ${run.taskRunId} ran the check for this price alert`,
    data: { eventId: run.eventId, taskRunId: run.taskRunId },
  });
