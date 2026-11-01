import type { MandateRepository } from "@entole/mandate";
import type { Clock } from "@entole/shared-kernel";
import type { OfferEvent } from "../domain/offer-event.ts";
import { mandatesToWake } from "./mandates-to-wake.ts";
import type { MandateCheckDispatcher } from "./ports.ts";
import { recordNotes, recordWakes } from "./record-wakes.ts";

export type HandleOfferEventDeps = {
  repo: Pick<MandateRepository, "listFundedLimitForProduct" | "appendAudit" | "recentNotes">;
  dispatcher: MandateCheckDispatcher;
  clock: Clock;
};

export type HandleOfferEventResult =
  | { outcome: "dispatched"; checks: number; notes: number }
  | { outcome: "dispatch_failed" };

// One Channel3 event: start a check for every order it wakes, then record the wakes and notes.
// It only starts checks and never waits for one, so the webhook answers inside Channel3's 15 s.
export const handleOfferEvent = async (
  deps: HandleOfferEventDeps,
  event: OfferEvent,
): Promise<HandleOfferEventResult> => {
  // A retry after a failed dispatch dispatches again; the mandate lock and one
  // PayPal-Request-Id per capture keep that from ever capturing twice.
  const { wake: ids, notes } = await mandatesToWake(deps, event);
  try {
    await Promise.all(ids.map((id) => deps.dispatcher.dispatch(id, { eventId: event.id })));
  } catch (err) {
    // Only the message: an SDK error can carry request details.
    console.error(`channel3 event ${event.id} dispatch failed:`, (err as Error).message);
    // Nothing recorded, notes included, so the sender's retry dispatches again.
    return { outcome: "dispatch_failed" };
  }
  // The checks are already started; a failed audit write must not make the sender retry and start
  // them again, so it is logged and the event still counts as handled. Wakes and notes fail
  // independently, so a lost note never costs a wake entry.
  const [woke, noted] = await Promise.allSettled([
    recordWakes(deps, ids, event),
    recordNotes(deps, notes, event),
  ]);
  if (woke.status === "rejected")
    console.error(`channel3 event ${event.id} wake audit failed:`, (woke.reason as Error).message);
  if (noted.status === "rejected")
    console.error(`channel3 event ${event.id} note audit failed:`, (noted.reason as Error).message);
  return {
    outcome: "dispatched",
    checks: ids.length,
    notes: noted.status === "fulfilled" ? noted.value.length : 0,
  };
};
