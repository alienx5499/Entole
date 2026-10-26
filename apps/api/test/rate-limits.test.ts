import { expect, test } from "bun:test";
import { createFunded, harness, login } from "./harness.ts";

const fromIp = (ip: string) => ({ headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });

test("one IP is capped across all routes, with Retry-After, while health checks never are", async () => {
  const h = harness();
  for (let i = 0; i < 240; i++)
    expect((await h.call("/api/me", fromIp("203.0.113.9"))).status).toBe(401);
  const limited = await h.call("/api/me", fromIp("203.0.113.9"));
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("60");
  expect(await limited.json()).toEqual({ error: "rate_limited" });
  expect((await h.call("/api/health", fromIp("203.0.113.9"))).status).toBe(200);
  expect((await h.call("/api/me", fromIp("198.51.100.4"))).status).toBe(401);
});

test("sign-in starts are capped per IP because each one leads to a PayPal call", async () => {
  const h = harness();
  const start = () => h.call("/api/auth/paypal/start", fromIp("203.0.113.10"));
  for (let i = 0; i < 20; i++) expect((await start()).status).toBe(302);
  expect((await start()).status).toBe(429);
});

test("closing and refunding are capped per user", async () => {
  const h = harness();
  const cookie = await login(h);
  const id = await createFunded(h, cookie);
  const close = () => h.call(`/api/mandates/${id}/close`, { method: "POST", cookie });
  for (let i = 0; i < 20; i++) expect((await close()).status).toBe(200);
  expect((await close()).status).toBe(429);
});

test("token creation is capped per user", async () => {
  const h = harness();
  const cookie = await login(h);
  const mint = (n: number) =>
    h.call("/api/tokens", { method: "POST", cookie, body: JSON.stringify({ name: `t${n}` }) });
  for (let i = 0; i < 10; i++) expect((await mint(i)).status).toBe(200);
  expect((await mint(10)).status).toBe(429);
});
