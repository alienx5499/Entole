import { describe, expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import { PayPalError, PayPalGateway } from "../../src/index.ts";

// The error bodies PayPal returns for the negative cases the live suite provokes with
// PayPal-Mock-Response, replayed through an injected fetch.

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status });
const unprocessable = (issue: string) =>
  json(
    {
      name: "UNPROCESSABLE_ENTITY",
      debug_id: "dbg-1",
      details: [{ issue, description: issue.toLowerCase() }],
    },
    422,
  );

const gatewayAnswering = (path: string, answer: () => Response) =>
  new PayPalGateway({
    clientId: "fake-id",
    clientSecret: "fake-secret",
    baseUrl: "https://api-m.sandbox.paypal.com",
    fetch: (async (input: string | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname === "/v1/oauth2/token")
        return json({ access_token: "tok", token_type: "Bearer", expires_in: 32000 }, 200);
      if (url.pathname === path) return answer();
      throw new Error(`unrouted ${url.pathname} ${init?.method ?? ""}`);
    }) as unknown as typeof fetch,
  });

const capture = (g: PayPalGateway) =>
  g.capture({
    authorizationId: "A1",
    amount: usd(7200),
    idempotencyKey: "m1-capture",
    invoiceId: "m1-1",
    final: true,
    note: "n",
  });

const rejection = async (p: Promise<unknown>): Promise<PayPalError> => {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  if (!(e instanceof PayPalError)) throw new Error(`expected PayPalError, got ${String(e)}`);
  return e;
};

describe("PayPalGateway negative answers", () => {
  const CAPTURE = "/v2/payments/authorizations/A1/capture";

  for (const issue of ["INSTRUMENT_DECLINED", "TRANSACTION_REFUSED", "PAYER_CANNOT_PAY"])
    test(`capture 422 ${issue} is a decline, not an error`, async () => {
      const g = gatewayAnswering(CAPTURE, () => unprocessable(issue));
      expect(await capture(g)).toEqual({ captureId: "", status: "DECLINED" });
    });

  for (const issue of [
    "AUTHORIZATION_EXPIRED",
    "DUPLICATE_INVOICE_ID",
    "MAX_CAPTURE_AMOUNT_EXCEEDED",
  ])
    test(`capture 422 ${issue} throws PayPalError with the issue`, async () => {
      const e = await rejection(capture(gatewayAnswering(CAPTURE, () => unprocessable(issue))));
      expect(e.status).toBe(422);
      expect(e.issues).toEqual([issue]);
      expect(e.debugId).toBe("dbg-1");
    });

  test("capture 500 throws, so the caller keeps the request id for the retry", async () => {
    const e = await rejection(
      capture(gatewayAnswering(CAPTURE, () => json({ name: "INTERNAL_SERVER_ERROR" }, 500))),
    );
    expect(e.status).toBe(500);
  });

  test("void after a capture throws: the hold was spent, not released", async () => {
    const g = gatewayAnswering("/v2/payments/authorizations/A1/void", () =>
      unprocessable("PREVIOUSLY_CAPTURED"),
    );
    const e = await rejection(g.voidAuthorization("A1"));
    expect(e.issues).toEqual(["PREVIOUSLY_CAPTURED"]);
  });

  test("refund over the captured amount throws PayPalError", async () => {
    const g = gatewayAnswering("/v2/payments/captures/C1/refund", () =>
      unprocessable("REFUND_AMOUNT_EXCEEDED"),
    );
    const e = await rejection(g.refundCapture({ captureId: "C1", idempotencyKey: "refund-m1" }));
    expect(e.issues).toEqual(["REFUND_AMOUNT_EXCEEDED"]);
  });
});
