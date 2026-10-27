import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import { PayPalError, PayPalGateway } from "../../src/index.ts";

const PATH = "/v2/payments/authorizations/A1/reauthorize";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const setup = (answer: () => Response) => {
  const sent: { headers: Headers; body: unknown }[] = [];
  const stub = (async (input: Request) => {
    const path = new URL(input.url).pathname;
    if (path === "/v1/oauth2/token")
      return json({ access_token: "tok", token_type: "Bearer", expires_in: 32000 });
    if (path !== PATH) throw new Error(`unrouted ${input.url}`);
    sent.push({ headers: input.headers, body: JSON.parse(await input.text()) });
    return answer();
  }) as unknown as typeof fetch;
  const gateway = new PayPalGateway({
    clientId: "id",
    clientSecret: "secret",
    baseUrl: "https://api-m.sandbox.paypal.com",
    fetch: stub,
  });
  const call = () =>
    gateway.reauthorize({
      authorizationId: "A1",
      amount: usd(8000),
      idempotencyKey: "reauthorize-A1",
    });
  return { call, sent };
};

const unprocessable = (issue: string) => () =>
  json({ name: "UNPROCESSABLE_ENTITY", debug_id: "d1", details: [{ issue }] }, 422);

test("reauthorize posts the same amount with the request id and returns the new authorization", async () => {
  const s = setup(() => json({ id: "A2", status: "CREATED" }, 201));
  expect(await s.call()).toEqual({ status: "renewed", authorizationId: "A2" });
  expect(s.sent[0]?.body).toEqual({ amount: { currency_code: "USD", value: "80.00" } });
  expect(s.sent[0]?.headers.get("paypal-request-id")).toBe("reauthorize-A1");
});

test("a declined or unsupported reauthorize is final", async () => {
  for (const issue of [
    "REAUTHORIZATION_DECLINED_BY_PROCESSOR",
    "REAUTHORIZATION_NOT_SUPPORTED",
    "AUTHORIZATION_EXPIRED",
  ])
    expect(await setup(unprocessable(issue)).call()).toEqual({ status: "denied", reason: issue });
  expect(await setup(() => json({ id: "A2", status: "DENIED" }, 201)).call()).toEqual({
    status: "denied",
    reason: "DENIED",
  });
});

test("too soon and server errors throw so the watcher retries", async () => {
  await expect(setup(unprocessable("REAUTHORIZATION_TOO_SOON")).call()).rejects.toBeInstanceOf(
    PayPalError,
  );
  await expect(setup(() => json({ debug_id: "d2" }, 500)).call()).rejects.toBeInstanceOf(
    PayPalError,
  );
});
