import { describe, expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import { PayPalError, PayPalGateway } from "../../src/index.ts";

const SECRET = "fake-secret-xyz";
const must = <T>(value: T | null | undefined, label: string): T => {
  if (value === undefined || value === null) throw new Error(`expected ${label} to exist`);
  return value;
};
type Call = { url: string; method: string; headers: Headers; body: unknown };

const setup = (routes: Record<string, () => Response>) => {
  const calls: Call[] = [];
  // The SDK hands fetch a Request; a URL and init are normalised the same way.
  const stub = (async (input: string | Request, init?: RequestInit) => {
    const req = typeof input === "string" ? new Request(input, init) : input;
    const text = await req.text();
    calls.push({
      url: new URL(req.url).pathname,
      method: req.method,
      headers: req.headers,
      body: text.startsWith("{") ? JSON.parse(text) : text || undefined,
    });
    const route = routes[new URL(req.url).pathname];
    if (!route) throw new Error(`unrouted ${req.url}`);
    return route();
  }) as unknown as typeof fetch;
  const gateway = new PayPalGateway({
    clientId: "fake-id",
    clientSecret: SECRET,
    baseUrl: "https://api-m.sandbox.paypal.com",
    fetch: stub,
  });
  return { gateway, calls };
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const token = () => json({ access_token: "tok", token_type: "Bearer", expires_in: 32000 });

describe("PayPalGateway", () => {
  test("createAuthorizationOrder sends AUTHORIZE order and returns payer-action link", async () => {
    const { gateway, calls } = setup({
      "/v1/oauth2/token": token,
      "/v2/checkout/orders": () =>
        json(
          {
            id: "O1",
            links: [
              { rel: "self", href: "x" },
              { rel: "payer-action", href: "https://pay/approve" },
            ],
          },
          201,
        ),
    });
    const r = await gateway.createAuthorizationOrder({
      mandateId: "m1",
      amount: usd(8000),
      customId: "digest",
      description: "Entole mandate",
      returnUrl: "https://r",
      cancelUrl: "https://c",
    });
    expect(r).toEqual({ orderId: "O1", approveUrl: "https://pay/approve" });
    const tokenCall = must(calls[0], "token call");
    expect(tokenCall.headers.get("authorization")).toBe(`Basic ${btoa(`fake-id:${SECRET}`)}`);
    const order = must(calls[1], "order call");
    expect(order.headers.get("paypal-request-id")).toBeTruthy();
    expect(order.headers.get("authorization")).toBe("Bearer tok");
    expect(order.body).toEqual({
      intent: "AUTHORIZE",
      purchase_units: [
        {
          custom_id: "digest",
          description: "Entole mandate",
          soft_descriptor: "ENTOLE LIMIT ORDER",
          items: [
            {
              name: "Entole mandate",
              quantity: "1",
              unit_amount: { currency_code: "USD", value: "80.00" },
              category: "PHYSICAL_GOODS",
            },
          ],
          amount: {
            currency_code: "USD",
            value: "80.00",
            breakdown: { item_total: { currency_code: "USD", value: "80.00" } },
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Entole",
            locale: "en-US",
            user_action: "CONTINUE",
            shipping_preference: "GET_FROM_FILE",
            return_url: "https://r",
            cancel_url: "https://c",
          },
        },
      },
    });
  });

  test("createAuthorizationOrder asks PayPal to call back about the ship-to address", async () => {
    const { gateway, calls } = setup({
      "/v1/oauth2/token": token,
      "/v2/checkout/orders": () =>
        json({ id: "O1", links: [{ rel: "payer-action", href: "https://pay/approve" }] }, 201),
    });
    await gateway.createAuthorizationOrder({
      mandateId: "m1",
      amount: usd(8000),
      customId: "digest",
      description: "Entole mandate",
      returnUrl: "https://r",
      cancelUrl: "https://c",
      shippingCallbackUrl: "https://entole.test/api/paypal/shipping-callback?mandate=m1",
    });
    const body = must(calls[1], "order call").body as {
      payment_source: { paypal: { experience_context: Record<string, unknown> } };
    };
    expect(body.payment_source.paypal.experience_context.order_update_callback_config).toEqual({
      callback_events: ["SHIPPING_ADDRESS"],
      callback_url: "https://entole.test/api/paypal/shipping-callback?mandate=m1",
    });
  });

  test("authorizeOrder reads authorization and custom_id", async () => {
    const { gateway, calls } = setup({
      "/v1/oauth2/token": token,
      "/v2/checkout/orders/O1/authorize": () =>
        json(
          {
            purchase_units: [
              {
                custom_id: "digest",
                payments: {
                  authorizations: [
                    {
                      id: "A1",
                      amount: { value: "80.00", currency_code: "USD" },
                      expiration_time: "2026-11-24T10:00:00Z",
                    },
                  ],
                },
              },
            ],
          },
          201,
        ),
    });
    const r = await gateway.authorizeOrder("O1");
    expect(r).toEqual({
      authorizationId: "A1",
      amount: usd(8000),
      expiresAt: new Date("2026-11-24T10:00:00Z"),
      customId: "digest",
    });
    expect(must(calls[1], "order call").headers.get("paypal-request-id")).toBeTruthy();
  });

  test("authorizeOrder reads the ship-to address the buyer picked in PayPal", async () => {
    const { gateway } = setup({
      "/v1/oauth2/token": token,
      "/v2/checkout/orders/O2/authorize": () =>
        json(
          {
            purchase_units: [
              {
                custom_id: "digest",
                shipping: {
                  name: { full_name: "Maya Buyer" },
                  address: {
                    address_line_1: "1 Main St",
                    address_line_2: "Apt 2",
                    admin_area_2: "San Jose",
                    admin_area_1: "CA",
                    postal_code: "95131",
                    country_code: "US",
                  },
                },
                payments: {
                  authorizations: [
                    {
                      id: "A2",
                      amount: { value: "80.00", currency_code: "USD" },
                      expiration_time: "2026-11-24T10:00:00Z",
                    },
                  ],
                },
              },
            ],
          },
          201,
        ),
    });
    const r = await gateway.authorizeOrder("O2");
    expect(r.shipTo).toEqual({
      name: "Maya Buyer",
      lines: ["1 Main St", "Apt 2"],
      city: "San Jose",
      region: "CA",
      postalCode: "95131",
      country: "US",
    });
  });

  test("refundCapture posts a full refund with the idempotency key as request id", async () => {
    const { gateway, calls } = setup({
      "/v1/oauth2/token": token,
      "/v2/payments/captures/C1/refund": () => json({ id: "R1", status: "COMPLETED" }, 201),
    });
    expect(await gateway.refundCapture({ captureId: "C1", idempotencyKey: "refund-m1" })).toEqual({
      refundId: "R1",
    });
    const call = must(calls.at(-1), "refund call");
    expect(call.method).toBe("POST");
    expect(call.headers.get("paypal-request-id")).toBe("refund-m1");
    expect(call.body).toBeUndefined();
  });

  test("capture sends partial capture with idempotency key as request id", async () => {
    const { gateway, calls } = setup({
      "/v1/oauth2/token": token,
      "/v2/payments/authorizations/A1/capture": () =>
        json(
          {
            id: "C1",
            status: "COMPLETED",
            seller_protection: { status: "ELIGIBLE" },
            seller_receivable_breakdown: {
              gross_amount: { currency_code: "USD", value: "30.05" },
              paypal_fee: { currency_code: "USD", value: "1.36" },
              net_amount: { currency_code: "USD", value: "28.69" },
            },
          },
          201,
        ),
    });
    const r = await gateway.capture({
      authorizationId: "A1",
      amount: usd(3005),
      idempotencyKey: "idem-1",
      invoiceId: "inv-1",
      final: false,
      note: "Entole: test item for $30.05",
    });
    expect(r).toEqual({
      captureId: "C1",
      status: "COMPLETED",
      sellerProtection: "ELIGIBLE",
      paypalFee: usd(136),
      net: usd(2869),
    });
    expect(must(calls[1], "order call").headers.get("paypal-request-id")).toBe("idem-1");
    expect(must(calls[1], "order call").body).toEqual({
      amount: { currency_code: "USD", value: "30.05" },
      final_capture: false,
      invoice_id: "inv-1",
      note_to_payer: "Entole: test item for $30.05",
    });
  });

  test("a final capture asks PayPal to release the rest of the hold", async () => {
    const { gateway, calls } = setup({
      "/v1/oauth2/token": token,
      "/v2/payments/authorizations/A1/capture": () => json({ id: "C2" }, 201),
    });
    await gateway.capture({
      authorizationId: "A1",
      amount: usd(12500),
      idempotencyKey: "idem-2",
      invoiceId: "inv-2",
      final: true,
      note: "x".repeat(300),
    });
    const body = must(calls[1], "capture call").body as {
      final_capture: boolean;
      note_to_payer: string;
    };
    expect(body.final_capture).toBe(true);
    expect(body.note_to_payer).toHaveLength(255);
  });

  test("voidAuthorization posts void and reuses the cached token", async () => {
    const { gateway, calls } = setup({
      "/v1/oauth2/token": token,
      "/v2/payments/authorizations/A1/void": () => new Response(null, { status: 204 }),
    });
    await gateway.voidAuthorization("A1");
    await gateway.voidAuthorization("A1");
    expect(calls.filter((c) => c.url === "/v1/oauth2/token")).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith("/void"))).toHaveLength(2);
  });

  test("422 throws PayPalError with debug_id and no secret", async () => {
    const { gateway } = setup({
      "/v1/oauth2/token": token,
      "/v2/payments/authorizations/A1/capture": () =>
        json({ debug_id: "dbg123", details: [{ issue: "AUTHORIZATION_AMOUNT_EXCEEDED" }] }, 422),
    });
    const err = await gateway
      .capture({
        authorizationId: "A1",
        amount: usd(1),
        idempotencyKey: "k",
        invoiceId: "i",
        final: false,
        note: "n",
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.status).toBe(422);
    expect(err.message).toContain("dbg123");
    expect(err.message).not.toContain(SECRET);
    expect(err.message).not.toContain("fake-id");
  });

  test("void with 422 already VOIDED or EXPIRED is success", async () => {
    for (const issue of ["AUTHORIZATION_VOIDED", "AUTHORIZATION_EXPIRED"]) {
      const { gateway } = setup({
        "/v1/oauth2/token": token,
        "/v2/payments/authorizations/A1/void": () =>
          json({ debug_id: "d", details: [{ issue }] }, 422),
      });
      await gateway.voidAuthorization("A1");
    }
  });

  test("void with another 422 throws PayPalError", async () => {
    const { gateway } = setup({
      "/v1/oauth2/token": token,
      "/v2/payments/authorizations/A1/void": () =>
        json({ debug_id: "d2", details: [{ issue: "PREVIOUS_REQUEST_IN_PROGRESS" }] }, 422),
    });
    await expect(gateway.voidAuthorization("A1")).rejects.toBeInstanceOf(PayPalError);
  });
});
