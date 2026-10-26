import { expect, test } from "bun:test";
import { readEnv, usd } from "@entole/shared-kernel";
import { PayPalGateway } from "../../src/index.ts";

// Needs a human: approve the printed URL as the sandbox buyer. Run with LIVE=1.
const live = process.env.LIVE === "1" ? test : test.skip;

live(
  "two partial captures then void on one sandbox authorization",
  async () => {
    const clientId = readEnv("PAYPAL_CLIENT_ID");
    const clientSecret = readEnv("PAYPAL_CLIENT_SECRET");
    const baseUrl = readEnv("PAYPAL_API_BASE");
    const gateway = new PayPalGateway({ clientId, clientSecret, baseUrl });

    const { orderId, approveUrl } = await gateway.createAuthorizationOrder({
      mandateId: `live-${Date.now()}`,
      amount: usd(8000),
      customId: "live-contract-test",
      description: "Entole live contract test",
      returnUrl: "https://example.com/return",
      cancelUrl: "https://example.com/cancel",
    });
    console.log(`Approve as the sandbox buyer: ${approveUrl}`);

    const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    const deadline = Date.now() + 5 * 60_000;
    let status = "";
    while (Date.now() < deadline && status !== "APPROVED") {
      await Bun.sleep(3000);
      const res = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      status = ((await res.json()) as { status: string }).status;
    }
    expect(status).toBe("APPROVED");

    const auth = await gateway.authorizeOrder(orderId);
    expect(auth.customId).toBe("live-contract-test");
    expect(auth.amount).toEqual(usd(8000));

    const first = await gateway.capture({
      authorizationId: auth.authorizationId,
      amount: usd(3000),
      idempotencyKey: `live-c1-${orderId}`,
      invoiceId: `inv-1-${orderId}`,
    });
    const second = await gateway.capture({
      authorizationId: auth.authorizationId,
      amount: usd(4200),
      idempotencyKey: `live-c2-${orderId}`,
      invoiceId: `inv-2-${orderId}`,
    });
    expect(first.captureId).toBeTruthy();
    expect(second.captureId).toBeTruthy();
    await gateway.voidAuthorization(auth.authorizationId);
  },
  6 * 60_000,
);
