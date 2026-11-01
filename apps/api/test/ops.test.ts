import { expect, test } from "bun:test";
import { harness } from "./harness.ts";

const rows = [
  { slot: 1, ok: true, status: 200, latencyMs: 12 },
  { slot: 2, ok: false, status: 401, latencyMs: 8, error: "status 401" },
];
const setup = (opsToken: string | null) => {
  const h = harness();
  let checks = 0;
  h.c.groqHealth = {
    check: async () => {
      checks++;
      return rows;
    },
  };
  h.c.opsToken = opsToken;
  const get = (auth?: string, ip = "1.2.3.4") =>
    h.call("/api/ops/groq", {
      headers: { ...(auth ? { authorization: auth } : {}), "x-forwarded-for": ip },
    });
  return { get, checks: () => checks };
};

test("the Groq key check is hidden when OPS_TOKEN is not set", async () => {
  const { get, checks } = setup(null);
  expect((await get("Bearer anything")).status).toBe(404);
  expect(checks()).toBe(0);
});

test("the Groq key check refuses a missing or wrong token", async () => {
  const { get, checks } = setup("ops-secret");
  expect((await get()).status).toBe(401);
  expect((await get("Bearer ops-secreT")).status).toBe(401);
  expect((await get("Bearer ops-secret-longer")).status).toBe(401);
  expect(checks()).toBe(0);
});

test("the Groq key check answers slots and status only with the right token", async () => {
  const { get } = setup("ops-secret");
  const res = await get("Bearer ops-secret");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ keys: rows });
});

test("the Groq key check is rate limited per IP", async () => {
  const { get } = setup("ops-secret");
  for (let i = 0; i < 10; i++) expect((await get("Bearer nope")).status).toBe(401);
  expect((await get("Bearer ops-secret")).status).toBe(429);
  expect((await get("Bearer ops-secret", "5.6.7.8")).status).toBe(200);
});

test("the Groq key check is also capped across all IPs", async () => {
  const { get } = setup("ops-secret");
  for (let i = 0; i < 30; i++)
    expect((await get("Bearer nope", `10.0.${i >> 3}.${i}`)).status).toBe(401);
  expect((await get("Bearer ops-secret", "9.9.9.9")).status).toBe(429);
});
