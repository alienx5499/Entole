import type { Clock, IdGenerator } from "@entole/shared-kernel";
import {
  type Mandate,
  type MandateTerms,
  newMandate,
  type RejectedCandidate,
} from "../domain/index.ts";
import type { MandateLock, MandateRepository, PaymentGateway } from "./ports.ts";

export type MandateDeps = {
  repo: MandateRepository;
  gateway: PaymentGateway;
  clock: Clock;
  ids: IdGenerator;
  lock?: MandateLock; // the in-process lock when absent
};

// The shortlisted candidates travel inside `terms`, so they are part of the signed digest.
export const createMandate = async (
  deps: MandateDeps,
  i: {
    ownerId: string;
    terms: MandateTerms;
    demoInjection: boolean;
    replay?: boolean;
    rejected?: RejectedCandidate[];
    baseUrl: string;
  },
): Promise<{ mandate: Mandate; approveUrl: string }> => {
  const mandate = newMandate({
    id: deps.ids.next("mandate"),
    ownerId: i.ownerId,
    now: deps.clock.now(),
    terms: i.terms,
    demoInjection: i.demoInjection,
    replay: i.replay ?? false,
    rejected: i.rejected ?? [],
  });
  const order = await deps.gateway.createAuthorizationOrder({
    mandateId: mandate.id,
    amount: mandate.terms.budget,
    customId: mandate.digest,
    description: `Entole mandate: ${mandate.terms.item.query}`,
    returnUrl: `${i.baseUrl}/api/paypal/return?mandate=${mandate.id}`,
    cancelUrl: `${i.baseUrl}/mandates/${mandate.id}/review?cancelled=1`,
  });
  await deps.repo.save(mandate);
  await deps.repo.linkOrder(mandate.id, order.orderId, order.approveUrl);
  await deps.repo.appendAudit(mandate.id, {
    at: deps.clock.now(),
    kind: "created",
    message: "Mandate created, waiting for PayPal approval",
    data: { digest: mandate.digest, orderId: order.orderId },
  });
  return { mandate, approveUrl: order.approveUrl };
};
