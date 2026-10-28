import { expect, test } from "bun:test";
import { hashApiToken } from "@entole/identity";
import { body, harness, login } from "./harness.ts";

const mint = async (h: ReturnType<typeof harness>, cookie: string, name = "Claude Desktop") => {
  const res = await h.call("/api/tokens", {
    method: "POST",
    body: JSON.stringify({ name }),
    cookie,
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; token: string };
};
const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

test("a token is shown once, stored hashed, and listed without secrets", async () => {
  const h = harness();
  const cookie = await login(h);
  const { id, token } = await mint(h, cookie);
  expect(token).toMatch(/^ent_[A-Za-z0-9_-]{43}$/);
  const list = await (await h.call("/api/tokens", { cookie })).json();
  expect(list).toEqual([
    {
      id,
      name: "Claude Desktop",
      createdAt: expect.any(String),
      lastUsedAt: null,
      revokedAt: null,
    },
  ]);
  expect(JSON.stringify(list)).not.toContain(token.slice(4));
  const stored = (h.c.apiTokens as unknown as { rows: Map<string, { hash: string }> }).rows;
  expect(stored.get(id)?.hash).toBe(hashApiToken(token));
});

test("a token can create, list, read and close its owner's mandates", async () => {
  const h = harness();
  const cookie = await login(h);
  const { token } = await mint(h, cookie);
  const created = await h.call("/api/mandates", { method: "POST", body: body(), ...bearer(token) });
  expect(created.status).toBe(200);
  const { id, approveUrl } = (await created.json()) as { id: string; approveUrl: string };
  expect(approveUrl).toContain("http");
  const list = (await (await h.call("/api/mandates", bearer(token))).json()) as { id: string }[];
  expect(list.map((m) => m.id)).toEqual([id]);
  expect((await h.call(`/api/mandates/${id}`, bearer(token))).status).toBe(200);
  expect((await h.call("/api/me", bearer(token))).status).toBe(200);
  const closed = await h.call(`/api/mandates/${id}/close`, { method: "POST", ...bearer(token) });
  expect(closed.status).toBe(200);
  const [t] = (await (await h.call("/api/tokens", { cookie })).json()) as { lastUsedAt: string }[];
  expect(t?.lastUsedAt).not.toBeNull();
});

test("a token cannot reach session-only routes", async () => {
  const h = harness();
  const cookie = await login(h);
  const { id, token } = await mint(h, cookie);
  const created = await h.call("/api/mandates", { method: "POST", body: body(), ...bearer(token) });
  const mandate = ((await created.json()) as { id: string }).id;
  for (const [method, path] of [
    ["GET", "/api/tokens"],
    ["POST", "/api/tokens"],
    ["DELETE", `/api/tokens/${id}`],
    ["GET", `/api/paypal/return?mandate=${mandate}&token=order-1`],
    ["POST", `/api/mandates/${mandate}/simulate`],
    ["POST", `/api/mandates/${mandate}/check-now`],
  ] as const) {
    const res = await h.call(path, {
      method,
      body: method === "GET" ? undefined : "{}",
      ...bearer(token),
    });
    // The PayPal return sends a session-less browser to log in instead of funding.
    if (path.startsWith("/api/paypal/return"))
      expect(res.headers.get("location")).toContain("/api/auth/paypal/start");
    else expect(res.status).toBe(401);
  }
  expect(h.gateway.captures).toHaveLength(0);
  // Logout ends a browser session only; it does not revoke tokens.
  await h.call("/api/auth/logout", { method: "POST", ...bearer(token) });
  expect((await h.call("/api/me", bearer(token))).status).toBe(200);
});

test("a revoked, unknown or malformed token gets 401 and never falls back to the cookie", async () => {
  const h = harness();
  const cookie = await login(h);
  const { id, token } = await mint(h, cookie);
  expect((await h.call(`/api/tokens/${id}`, { method: "DELETE", cookie })).status).toBe(200);
  expect((await h.call(`/api/tokens/${id}`, { method: "DELETE", cookie })).status).toBe(404);
  expect((await h.call("/api/mandates", bearer(token))).status).toBe(401);
  expect((await h.call("/api/mandates", { ...bearer("ent_nope"), cookie })).status).toBe(401);
  expect(
    (await h.call("/api/mandates", { headers: { authorization: "Basic x" }, cookie })).status,
  ).toBe(401);
});

test("another user cannot revoke a token, and names are validated", async () => {
  const h = harness();
  const alice = await login(h, "alice");
  const bob = await login(h, "bob");
  const { id, token } = await mint(h, alice);
  expect((await h.call(`/api/tokens/${id}`, { method: "DELETE", cookie: bob })).status).toBe(404);
  expect((await h.call("/api/me", bearer(token))).status).toBe(200);
  const bad = await h.call("/api/tokens", {
    method: "POST",
    body: JSON.stringify({ name: " " }),
    cookie: alice,
  });
  expect(await bad.json()).toEqual({ error: "invalid_field", field: "name" });
});

test("mandate creation is rate limited for token callers too", async () => {
  const h = harness();
  const cookie = await login(h);
  const { token } = await mint(h, cookie);
  // The limiter counts before validation, so ten invalid bodies use up the window.
  const post = () =>
    h.call("/api/mandates", { method: "POST", body: body({ validDays: 30 }), ...bearer(token) });
  for (let i = 0; i < 10; i++) expect((await post()).status).toBe(400);
  expect((await post()).status).toBe(429);
});
