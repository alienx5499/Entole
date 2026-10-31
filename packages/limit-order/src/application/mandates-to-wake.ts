import type { MandateRepository } from "@entole/mandate";
import { type OfferEvent, shouldCheck } from "../domain/offer-event.ts";

export type MandatesToWakeDeps = { repo: Pick<MandateRepository, "listFundedLimitForProduct"> };

// The funded limit mandates this event should wake. Reads only.
export const mandatesToWake = async (deps: MandatesToWakeDeps, e: OfferEvent): Promise<string[]> =>
  (await deps.repo.listFundedLimitForProduct(e.productId))
    .filter((m) => shouldCheck(m, e))
    .map((m) => m.id);
