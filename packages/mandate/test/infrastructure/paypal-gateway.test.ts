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
  // The SDK hands fetch a Request; the raw webhook call passes a URL and init. Normalise both.
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
          amount: { currency_code: "USD", value: "80.00" },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            user_action: "CONTINUE",
            shipping_preference: "NO_SHIPPING",
            return_url: "https://r",
            cancel_url: "https://c",
          },
        },
      },
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
      "/v2/payments/authorizations/A1/capture": () => json({ id: "C1" }, 201),
    });
    const r = await gateway.capture({
      authorizationId: "A1",
      amount: usd(3005),
      idempotencyKey: "idem-1",
      invoiceId: "inv-1",
    });
    expect(r).toEqual({ captureId: "C1" });
    expect(must(calls[1], "order call").headers.get("paypal-request-id")).toBe("idem-1");
    expect(must(calls[1], "order call").body).toEqual({
      amount: { currency_code: "USD", value: "30.05" },
      final_capture: false,
      invoice_id: "inv-1",
    });
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

  test("verifyWebhookSignature sends the headers, webhook id and the raw event", async () => {
    const verify = (status: string) =>
      setup({
        "/v1/oauth2/token": token,
        "/v1/notifications/verify-webhook-signature": () => json({ verification_status: status }),
      });
    const headers = new Headers({
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api.sandbox.paypal.com/cert.pem",
      "paypal-transmission-id": "T1",
      "paypal-transmission-sig": "sig==",
      "paypal-transmission-time": "2026-10-26T12:00:00Z",
    });
    const raw = '{"id":"WH-1","event_type":"CHECKOUT.ORDER.APPROVED"}';
    const ok = verify("SUCCESS");
    expect(await ok.gateway.verifyWebhookSignature("WEBHOOK-1", headers, raw)).toBe(true);
    const call = must(ok.calls[1], "verify call");
    expect(call.headers.get("authorization")).toBe("Bearer tok");
    // Never the caller-supplied transmission id, and fresh on every call.
    const requestId = call.headers.get("paypal-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestId).not.toContain("T1");
    await ok.gateway.verifyWebhookSignature("WEBHOOK-1", headers, raw);
    expect(must(ok.calls[2], "second verify").headers.get("paypal-request-id")).not.toBe(requestId);
    expect(call.body).toEqual({
      auth_algo: "SHA256withRSA",
      cert_url: "https://api.sandbox.paypal.com/cert.pem",
      transmission_id: "T1",
      transmission_sig: "sig==",
      transmission_time: "2026-10-26T12:00:00Z",
      webhook_id: "WEBHOOK-1",
      webhook_event: { id: "WH-1", event_type: "CHECKOUT.ORDER.APPROVED" },
    });
    const bad = verify("FAILURE");
    expect(await bad.gateway.verifyWebhookSignature("WEBHOOK-1", headers, raw)).toBe(false);
  });

  test("verifyWebhookSignature: no headers means false without calling PayPal; 4xx means false", async () => {
    const none = setup({ "/v1/oauth2/token": token });
    expect(await none.gateway.verifyWebhookSignature("WEBHOOK-1", new Headers(), "{}")).toBe(false);
    expect(none.calls).toHaveLength(0);
    const rejected = setup({
      "/v1/oauth2/token": token,
      "/v1/notifications/verify-webhook-signature": () => json({ name: "VALIDATION_ERROR" }, 400),
    });
    const signed = new Headers({
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://api.sandbox.paypal.com/cert.pem",
      "paypal-transmission-id": "T2",
      "paypal-transmission-sig": "sig==",
      "paypal-transmission-time": "2026-10-26T12:00:00Z",
    });
    expect(await rejected.gateway.verifyWebhookSignature("WEBHOOK-1", signed, "{}")).toBe(false);
  });

  test("422 throws PayPalError with debug_id and no secret", async () => {
    const { gateway } = setup({
      "/v1/oauth2/token": token,
      "/v2/payments/authorizations/A1/capture": () =>
        json({ debug_id: "dbg123", details: [{ issue: "AUTHORIZATION_AMOUNT_EXCEEDED" }] }, 422),
    });
    const err = await gateway
      .capture({ authorizationId: "A1", amount: usd(1), idempotencyKey: "k", invoiceId: "i" })
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
