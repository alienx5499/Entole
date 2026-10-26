import { type Clock, formatUsd, type IdGenerator } from "@entole/shared-kernel";
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
    description: orderDescription(mandate.terms),
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

// What the buyer reads on the PayPal approval page: the signed terms in one line (PayPal caps it at 127).
const orderDescription = (t: MandateTerms): string => {
  const options = Object.entries(t.item.requiredAttributes).map(([k, v]) => `${k} ${v}`);
  const price =
    t.kind === "limit"
      ? `at or below $${formatUsd(t.maxUnitPrice)}`
      : `up to $${formatUsd(t.budget)}`;
  const until = t.validUntil.toISOString().slice(0, 10);
  const label = t.kind === "limit" ? "Entole limit order" : "Entole order";
  const text = [`${label}: ${t.item.query}`, ...options, price, `until ${until}`].join(", ");
  return text.length > 127 ? `${text.slice(0, 126)}…` : text;
};
