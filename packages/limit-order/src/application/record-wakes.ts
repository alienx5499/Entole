import type { MandateRepository } from "@entole/mandate";
import { type Clock, formatUsd } from "@entole/shared-kernel";
import type { OfferEvent } from "../domain/offer-event.ts";

export type RecordWakesDeps = { repo: Pick<MandateRepository, "appendAudit">; clock: Clock };

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
