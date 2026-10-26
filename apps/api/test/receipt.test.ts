import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import { createFunded, harness, login, NOW } from "./harness.ts";

type Receipt = {
  paypalOrderId: string | null;
  authorizationId: string | null;
  captureId: string | null;
  refundId: string | null;
  customId: string;
  amounts: Record<"held" | "captured" | "released" | "refunded", string>;
  times: Record<"approved" | "captured" | "released" | "refunded", string | null>;
  confirmations: { eventType: string; eventId: string; message: string }[];
};
type View = { digest: string; receipt: Receipt };

const get = async (h: ReturnType<typeof harness>, id: string, cookie: string) =>
  (await (await h.call(`/api/mandates/${id}`, { cookie })).json()) as View;

test("receipt carries the PayPal ids, amounts, times and the digest as custom_id", async () => {
  const h = harness();
  const cookie = await login(h);
  const id = await createFunded(h, cookie);
  const held = (await get(h, id, cookie)).receipt;
  expect(held.paypalOrderId).toBe("order-1");
  expect(held.authorizationId).not.toBeNull();
  expect(held.captureId).toBeNull();
  expect(held.times.approved).not.toBeNull();
  expect(held.amounts.captured).toBe("0.00");

  h.offer.price = usd(16900);
  await h.call(`/api/mandates/${id}/check-now`, { method: "POST", cookie });
  const view = await get(h, id, cookie);
  const r = view.receipt;
  expect(r.customId).toBe(view.digest);
  expect(h.gateway.orders.at(-1)?.customId).toBe(view.digest);
  expect(r.captureId).toBeTruthy();
  expect(r.amounts.captured).toBe("169.00");
  expect(Number(r.amounts.released)).toBeGreaterThan(0);
  expect(r.times.captured).not.toBeNull();
  expect(r.times.released).not.toBeNull();
  expect(r.times.refunded).toBeNull();

  await h.call(`/api/mandates/${id}/refund`, { method: "POST", cookie });
  const refunded = (await get(h, id, cookie)).receipt;
  expect(refunded.refundId).toBeTruthy();
  expect(refunded.amounts.refunded).toBe("169.00");
  expect(refunded.times.refunded).not.toBeNull();
});

test("a release without a purchase shows the released amount and no capture", async () => {
  const h = harness();
  const cookie = await login(h);
  const id = await createFunded(h, cookie);
  await h.call(`/api/mandates/${id}/close`, { method: "POST", cookie });
  const r = (await get(h, id, cookie)).receipt;
  expect(r.captureId).toBeNull();
  expect(r.amounts.released).toBe(r.amounts.held);
  expect(r.times.released).not.toBeNull();
});

test("verified PayPal webhook confirmations appear on the receipt", async () => {
  const h = harness();
  h.c.webhooks = { verify: async () => true };
  const cookie = await login(h);
  const id = await createFunded(h, cookie);
  await h.call("/api/paypal/webhook", {
    method: "POST",
    headers: { "paypal-transmission-time": NOW.toISOString() },
    body: JSON.stringify({
      id: "WH-9",
      event_type: "PAYMENT.AUTHORIZATION.VOIDED",
      resource: { id: "auth-1", supplementary_data: { related_ids: { order_id: "order-1" } } },
    }),
  });
  const r = (await get(h, id, cookie)).receipt;
  expect(r.confirmations).toMatchObject([
    { eventType: "PAYMENT.AUTHORIZATION.VOIDED", eventId: "WH-9" },
  ]);
});
