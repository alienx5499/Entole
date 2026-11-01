import type { MandateRepository } from "@entole/mandate";
import type { Money } from "@entole/shared-kernel";
import { classifyOfferEvent, type NoteReason, type OfferEvent } from "../domain/offer-event.ts";

export type MandatesToWakeDeps = { repo: Pick<MandateRepository, "listFundedLimitForProduct"> };

// An order the event is about but does not wake; recorded on its timeline only.
export type OfferNote = { mandateId: string; reason: NoteReason; limit: Money };

export type OfferEventMatches = { wake: string[]; notes: OfferNote[] };

// The funded limit mandates this event should wake, and those it is only worth a note on. Reads
// only, and no audit history: it runs before the checks start, inside Channel3's 15 s budget.
export const mandatesToWake = async (
  deps: MandatesToWakeDeps,
  e: OfferEvent,
): Promise<OfferEventMatches> => {
  const wake: string[] = [];
  const notes: OfferNote[] = [];
  for (const m of await deps.repo.listFundedLimitForProduct(e.productId)) {
    const verdict = classifyOfferEvent(m, e);
    if (verdict?.kind === "wake") wake.push(m.id);
    if (verdict?.kind === "note")
      notes.push({ mandateId: m.id, reason: verdict.reason, limit: m.terms.maxUnitPrice });
  }
  return { wake, notes };
};
