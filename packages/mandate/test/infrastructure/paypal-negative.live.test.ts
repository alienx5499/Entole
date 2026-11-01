import { describe, expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import { LIVE, readEnv } from "@entole/testing";
import { PayPalError, PayPalGateway } from "../../src/index.ts";

// PayPal sandbox negative testing: the PayPal-Mock-Response header makes the sandbox answer with
// a chosen error. The header is added by the fetch this test injects, so the production gateway
// never sends it. Needs LIVE=1 and sandbox credentials; no buyer approval, so ids can be dummies.
const creds = !!process.env.PAYPAL_CLIENT_ID && !!process.env.PAYPAL_CLIENT_SECRET;
const live = LIVE && creds ? test : test.skip;

const SANDBOX = "https://api-m.sandbox.paypal.com";

// A gateway whose requests to `path` carry PayPal-Mock-Response with the given error code.
const mocked = (path?: string, code?: string) => {
  if (readEnv("PAYPAL_API_BASE").replace(/\/+$/, "") !== SANDBOX)
    throw new Error("Negative tests run against the PayPal sandbox only");
  const mockFetch = (async (input: string | Request, init?: RequestInit) => {
    const req = typeof input === "string" ? new Request(input, init) : new Request(input, init);
    if (code && new URL(req.url).pathname === path)
      req.headers.set("PayPal-Mock-Response", JSON.stringify({ mock_application_codes: code }));
    return fetch(req);
  }) as unknown as typeof fetch;
  return new PayPalGateway({
    clientId: readEnv("PAYPAL_CLIENT_ID"),
    clientSecret: readEnv("PAYPAL_CLIENT_SECRET"),
    baseUrl: SANDBOX,
    fetch: mockFetch,
  });
};

const AUTH = "0VF52814937998046"; // shape of a sandbox authorization id; mocks answer before lookup
const CAPTURE_PATH = `/v2/payments/authorizations/${AUTH}/capture`;

const capture = (g: PayPalGateway, key: string) =>
  g.capture({
    authorizationId: AUTH,
    amount: usd(7200),
    idempotencyKey: key,
    invoiceId: `neg-${key}`,
    final: true,
    note: "Entole negative test",
  });

const rejection = async (p: Promise<unknown>): Promise<PayPalError> => {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  if (!(e instanceof PayPalError)) throw new Error(`expected PayPalError, got ${String(e)}`);
  return e;
};

describe("PayPal sandbox negative answers", () => {
  // proposeOrder audits capture_failed with paypalStatus DECLINED and rotates the request id.
  // Sandbox answers a mocked INSTRUMENT_DECLINED on an authorization capture with a bare 403, so
  // the decline is driven with TRANSACTION_REFUSED, which returns the 422 a real refusal does.
  live("declined capture comes back as DECLINED", async () => {
    const g = mocked(CAPTURE_PATH, "TRANSACTION_REFUSED");
    expect(await capture(g, `neg-decline-${Date.now()}`)).toEqual({
      captureId: "",
      status: "DECLINED",
    });
  });

  // proposeOrder audits capture_failed without paypalStatus and keeps the request id.
  live("expired authorization throws AUTHORIZATION_EXPIRED", async () => {
    const e = await rejection(
      capture(mocked(CAPTURE_PATH, "AUTHORIZATION_EXPIRED"), `neg-exp-${Date.now()}`),
    );
    expect(e.status).toBe(422);
    expect(e.issues).toContain("AUTHORIZATION_EXPIRED");
    expect(e.debugId).toBeTruthy();
  });

  // The invoice id moves on per attempt, so this is a plain capture_failed and the next try passes.
  live("duplicate invoice id throws DUPLICATE_INVOICE_ID", async () => {
    const e = await rejection(
      capture(mocked(CAPTURE_PATH, "DUPLICATE_INVOICE_ID"), `neg-dup-${Date.now()}`),
    );
    expect(e.issues).toContain("DUPLICATE_INVOICE_ID");
  });

  // Same PayPal-Request-Id, same answer: a retried create cannot open a second order.
  live("a replayed request id returns the first order", async () => {
    const g = mocked();
    const order = {
      mandateId: `neg-replay-${Date.now()}`,
      amount: usd(8000),
      customId: "neg-replay",
      description: "Entole negative test",
      returnUrl: "https://example.com/return",
      cancelUrl: "https://example.com/cancel",
    };
    const first = await g.createAuthorizationOrder(order);
    const again = await g.createAuthorizationOrder(order);
    expect(again.orderId).toBe(first.orderId);
  });

  // closeMandate counts a void attempt and, after three, audits "Release failed; contact support".
  live("void after a capture throws PREVIOUSLY_CAPTURED", async () => {
    const g = mocked(`/v2/payments/authorizations/${AUTH}/void`, "PREVIOUSLY_CAPTURED");
    const e = await rejection(g.voidAuthorization(AUTH));
    expect(e.status).toBe(422);
    expect(e.issues).toContain("PREVIOUSLY_CAPTURED");
  });

  // refundMandate throws before saving, so nothing is recorded and the retry reuses refund-<id>.
  live("refund over the captured amount throws REFUND_AMOUNT_EXCEEDED", async () => {
    const id = "2GG279541U471931P";
    const g = mocked(`/v2/payments/captures/${id}/refund`, "REFUND_AMOUNT_EXCEEDED");
    const e = await rejection(
      g.refundCapture({ captureId: id, idempotencyKey: `neg-${Date.now()}` }),
    );
    expect(e.status).toBe(422);
    expect(e.issues).toContain("REFUND_AMOUNT_EXCEEDED");
  });
});
