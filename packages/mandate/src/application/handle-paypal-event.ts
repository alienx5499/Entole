import { InvalidTransition, type Mandate } from "../domain/index.ts";
import type { MandateDeps } from "./create-mandate.ts";
import { fundMandate } from "./fund-mandate.ts";

// The fields Entole reads from a verified PayPal webhook event.
export type PayPalEvent = {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
};

export type PayPalEventResult =
  | { outcome: "funded"; mandate: Mandate }
  | { outcome: "audited" }
  | { outcome: "duplicate" }
  | { outcome: "ignored" };

const CONFIRMATIONS: Record<string, string> = {
  "PAYMENT.CAPTURE.COMPLETED": "PayPal confirmed the capture",
  "PAYMENT.CAPTURE.DENIED": "PayPal confirmed the capture was denied",
  "PAYMENT.CAPTURE.PENDING": "PayPal reports the capture is still pending",
  "PAYMENT.CAPTURE.REVERSED": "PayPal confirmed the capture was reversed",
  "PAYMENT.CAPTURE.REFUNDED": "PayPal confirmed the capture was refunded",
  "PAYMENT.AUTHORIZATION.VOIDED": "PayPal confirmed the hold was released",
};

// Runs a verified event once per event id. Unknown orders and event types are ignored, never an
// error: PayPal retries any non-2xx delivery for days.
export const handlePayPalEvent = async (
  deps: MandateDeps,
  e: PayPalEvent,
): Promise<PayPalEventResult> => {
  const confirmation = CONFIRMATIONS[e.event_type];
  if (e.event_type !== "CHECKOUT.ORDER.APPROVED" && !confirmation) return { outcome: "ignored" };
  if (!(await deps.repo.claimWebhookEvent(e.id))) return { outcome: "duplicate" };
  try {
    return confirmation ? await confirm(deps, e, confirmation) : await approve(deps, e);
  } catch (err) {
    await deps.repo.releaseWebhookEvent(e.id);
    throw err;
  }
};

// The browser redirect may have funded the mandate first; then there is nothing left to do.
const approve = async (deps: MandateDeps, e: PayPalEvent): Promise<PayPalEventResult> => {
  const orderId = e.resource?.id ?? "";
  const m = orderId ? await deps.repo.findByOrderId(orderId) : null;
  if (m?.status !== "awaiting_approval") return { outcome: "ignored" };
  try {
    return { outcome: "funded", mandate: await fundMandate(deps, { mandateId: m.id, orderId }) };
  } catch (err) {
    // Lost the race to the redirect while waiting for the lock.
    if (err instanceof InvalidTransition) return { outcome: "ignored" };
    throw err;
  }
};

const confirm = async (
  deps: MandateDeps,
  e: PayPalEvent,
  message: string,
): Promise<PayPalEventResult> => {
  const orderId = e.resource?.supplementary_data?.related_ids?.order_id ?? "";
  const m = orderId ? await deps.repo.findByOrderId(orderId) : null;
  if (!m) return { outcome: "ignored" };
  await deps.repo.appendAudit(m.id, {
    at: deps.clock.now(),
    kind: "paypal_event",
    message,
    data: { eventId: e.id, eventType: e.event_type, resourceId: e.resource?.id ?? "" },
  });
  return { outcome: "audited" };
};
