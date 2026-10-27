import {
  type Mandate,
  type ShippingIssue,
  type ShipToRegion,
  shippingIssue,
} from "../domain/index.ts";
import type { MandateDeps } from "./create-mandate.ts";

export type ShipToCheck =
  | { outcome: "unknown" }
  | { outcome: "accepted"; mandate: Mandate }
  | { outcome: "refused"; mandate: Mandate; issue: ShippingIssue };

// PayPal's order update callback: may this mandate's order ship to the address the buyer picked?
// Only an order still on the approval page, linked to the mandate named in the callback URL,
// gets an answer. A refusal is audited; an acceptance is not, since PayPal asks on every load.
export const checkShipTo = async (
  deps: Pick<MandateDeps, "repo" | "clock">,
  i: { mandateId: string; orderId: string; to: ShipToRegion },
): Promise<ShipToCheck> => {
  const m = i.orderId ? await deps.repo.findByOrderId(i.orderId) : null;
  if (!m || m.id !== i.mandateId || m.status !== "awaiting_approval") return { outcome: "unknown" };
  const issue = shippingIssue(i.to);
  if (!issue) return { outcome: "accepted", mandate: m };
  await deps.repo.appendAudit(m.id, {
    at: deps.clock.now(),
    kind: "ship_to_refused",
    message: "PayPal asked to ship outside the signed shops' region; Entole refused it",
    data: { country: i.to.country, issue, orderId: i.orderId },
  });
  return { outcome: "refused", mandate: m, issue };
};
