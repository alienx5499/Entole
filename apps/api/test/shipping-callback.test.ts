import { expect, test } from "bun:test";
import { body, harness, login, NOW } from "./harness.ts";

const callback = (
  h: ReturnType<typeof harness>,
  mandateId: string,
  payload: unknown,
  sig = "good",
  extra: Record<string, string> = {},
) =>
  h.call(`/api/paypal/shipping-callback?mandate=${encodeURIComponent(mandateId)}`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      "paypal-transmission-sig": sig,
      "paypal-transmission-time": NOW.toISOString(),
      ...extra,
    },
  });

const address = (country: string, orderId = "order-1") => ({
  id: orderId,
  shipping_address: { country_code: country, admin_area_1: "TX", postal_code: "75001" },
  purchase_units: [{ reference_id: "default", amount: { currency_code: "USD", value: "170.00" } }],
});

// A mandate on PayPal's approval page, linked to order-1.
const awaiting = async (h: ReturnType<typeof harness>) => {
  const cookie = await login(h);
  const res = await h.call("/api/mandates", { method: "POST", body: body(), cookie });
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
};

test("a US address is accepted with the signed total and one free shipping option", async () => {
  const h = harness();
  const id = await awaiting(h);
  const res = await callback(h, id, address("US"));
  expect(res.status).toBe(200);
  const usd = (value: string) => ({ currency_code: "USD", value });
  expect(await res.json()).toEqual({
    id: "order-1",
    purchase_units: [
      {
        reference_id: "default",
        amount: {
          ...usd("170.00"),
          breakdown: { item_total: usd("170.00"), shipping: usd("0.00") },
        },
        shipping_options: [
          {
            id: "included",
            label: "Shipping within your limit",
            type: "SHIPPING",
            selected: true,
            amount: usd("0.00"),
          },
        ],
      },
    ],
  });
  expect((await h.repo.listAudit(id)).map((e) => e.kind)).toEqual(["created"]);
});

test("a foreign address gets PayPal's 422 COUNTRY_ERROR and an audit entry", async () => {
  const h = harness();
  const id = await awaiting(h);
  const res = await callback(h, id, address("CA"));
  expect(res.status).toBe(422);
  expect(await res.json()).toEqual({
    name: "UNPROCESSABLE_ENTITY",
    details: [{ issue: "COUNTRY_ERROR" }],
  });
  const refused = (await h.repo.listAudit(id)).find((e) => e.kind === "ship_to_refused");
  expect(refused?.data).toEqual({ country: "CA", issue: "COUNTRY_ERROR", orderId: "order-1" });
});

test("unknown orders, another mandate's order and funded mandates all get the same 404", async () => {
  const h = harness();
  const id = await awaiting(h);
  const notFound = { error: "not_found" };
  for (const [mandate, order] of [
    [id, "order-404"],
    ["mandate_other", "order-1"],
    ["", "order-1"],
  ] as const) {
    const res = await callback(h, mandate, address("CA", order));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(notFound);
  }
  const ret = await h.call(`/api/paypal/return?mandate=${id}&token=order-1`, {
    cookie: await login(h),
  });
  expect(ret.status).toBe(302);
  const funded = await callback(h, id, address("US"));
  expect(funded.status).toBe(404);
  expect(await funded.json()).toEqual(notFound);
  expect((await h.repo.listAudit(id)).some((e) => e.kind === "ship_to_refused")).toBe(false);
});

test("an unsigned, stale or malformed callback is refused", async () => {
  const h = harness();
  const id = await awaiting(h);
  const forged = await callback(h, id, address("US"), "forged");
  expect(forged.status).toBe(401);
  expect(await forged.json()).toEqual({ error: "invalid_signature" });
  const stale = await callback(h, id, address("US"), "good", {
    "paypal-transmission-time": new Date(NOW.getTime() - 3_600_000).toISOString(),
  });
  expect(stale.status).toBe(400);
  expect((await callback(h, id, { id: "order-1" })).status).toBe(400);
});
