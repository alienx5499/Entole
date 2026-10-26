import { describe, expect, test } from "bun:test";
import { PayPalIdentity } from "../../src/index.ts";

const cfg = {
  clientId: "cid",
  clientSecret: "csecret",
  baseUrl: "https://api-m.sandbox.paypal.com",
  publicBaseUrl: "https://entole.example",
};

const setup = (responses: Response[]) => {
  const calls: { url: URL; method: string; headers: Record<string, string>; body?: string }[] = [];
  const stub = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: new URL(url),
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
    });
    return responses.shift() as Response;
  }) as unknown as typeof fetch;
  return { id: new PayPalIdentity({ ...cfg, fetch: stub }), calls };
};

describe("PayPalIdentity", () => {
  test("authorizeUrl carries the sandbox login params", () => {
    const { id } = setup([]);
    const raw = id.authorizeUrl("st8");
    expect(raw).toContain("scope=openid%20email%20profile");
    const u = new URL(raw);
    expect(`${u.origin}${u.pathname}`).toBe("https://www.sandbox.paypal.com/signin/authorize");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      flowEntry: "static",
      client_id: "cid",
      response_type: "code",
      scope: "openid email profile",
      redirect_uri: "https://entole.example/api/auth/paypal/callback",
      state: "st8",
    });
  });

  test("exchange swaps the code, then reads the primary email and name", async () => {
    const { id, calls } = setup([
      new Response(JSON.stringify({ access_token: "tok" })),
      new Response(
        JSON.stringify({
          user_id: "https://www.paypal.com/webapps/auth/identity/user/abc",
          name: "Sam Buyer",
          emails: [
            { value: "other@x.com", primary: false },
            { value: "sam@x.com", primary: true },
          ],
        }),
      ),
    ]);
    const out = await id.exchange("the-code");
    expect(calls[0]?.url.pathname).toBe("/v1/oauth2/token");
    expect(calls[0]?.headers.Authorization).toBe(`Basic ${btoa("cid:csecret")}`);
    expect(calls[0]?.body).toBe("grant_type=authorization_code&code=the-code");
    expect(calls[1]?.url.pathname).toBe("/v1/identity/oauth2/userinfo");
    expect(calls[1]?.url.searchParams.get("schema")).toBe("paypalv1.1");
    expect(calls[1]?.headers.Authorization).toBe("Bearer tok");
    expect(out).toEqual({
      paypalUserId: "https://www.paypal.com/webapps/auth/identity/user/abc",
      email: "sam@x.com",
      name: "Sam Buyer",
    });
  });

  test("errors never contain the code, token or secret", async () => {
    const { id } = setup([new Response("the-code csecret", { status: 400 })]);
    const err = await id.exchange("the-code").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    for (const s of ["the-code", "csecret", "tok"]) expect(msg).not.toContain(s);
  });
});
