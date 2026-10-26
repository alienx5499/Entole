import { expect, test } from "bun:test";
import { usd } from "@entole/shared-kernel";
import { FakePriceTracker, ScriptedAgentModel } from "@entole/testing";
import { body, cookieValue, createFunded, HistoryTracker, harness, login, NOW } from "./harness.ts";

test("health answers without touching the repository", async () => {
  const h = harness();
  const res = await h.call("/api/health");
  expect(await res.json()).toEqual({ ok: true });
  expect(h.repo.gets).toBe(0);
});

test("state-changing routes return 401 without a session", async () => {
  const h = harness();
  const res = await h.call("/api/mandates", { method: "POST", body: body() });
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
  expect((await h.call("/api/mandates/x/close", { method: "POST" })).status).toBe(401);
  expect((await h.call("/api/me")).status).toBe(401);
});

test("callback with a state that does not match the cookie gives 400", async () => {
  const h = harness();
  const start = await h.call("/api/auth/paypal/start");
  expect(start.status).toBe(302);
  const stateCookie = start.headers.getSetCookie()[0] ?? "";
  expect(stateCookie).toContain("HttpOnly");
  expect(stateCookie).toContain("Max-Age=600");
  const state = cookieValue(start, "entole_oauth_state");
  const res = await h.call("/api/auth/paypal/callback?code=abc&state=forged", {
    cookie: `entole_oauth_state=${state}`,
  });
  expect(res.status).toBe(400);
  expect(res.headers.getSetCookie()).toEqual([]);
});

test("validDays 4 is rejected with 400 and the field name", async () => {
  const h = harness();
  const cookie = await login(h);
  const res = await h.call("/api/mandates", {
    method: "POST",
    body: body({ validDays: 4 }),
    cookie,
  });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid_field", field: "validDays" });
});

test("create, PayPal return and check-now reach closed with one capture", async () => {
  const h = harness();
  const cookie = await login(h);
  const id = await createFunded(h, cookie);
  expect(h.watch.activeCount).toBe(1);

  const first = await h.call(`/api/mandates/${id}/check-now`, { method: "POST", cookie });
  expect(((await first.json()) as { captured: string[] }).captured).toEqual([]);

  h.offer.price = usd(16900);
  const res = await h.call(`/api/mandates/${id}/check-now`, { method: "POST", cookie });
  const out = (await res.json()) as {
    captured: string[];
    mandate: { status: string; remaining: string; purchase: Record<string, unknown> };
  };
  expect(out.captured).toEqual([id]);
  expect(out.mandate.status).toBe("closed");
  expect(out.mandate.purchase).toMatchObject({
    productId: "p1",
    price: "169.00",
    savings: "11.00",
    inReplay: false,
  });
  expect(h.gateway.captures).toHaveLength(1);
  expect(h.gateway.voids).toHaveLength(1);
  expect(h.watch.activeCount).toBe(0); // dropped on close, not on the next tick
  const me = (await (await h.call("/api/me", { cookie })).json()) as { taste: unknown };
  expect(me.taste).toEqual({ brands: [], avoid: ["white"], attributes: { Size: "10" } });
});

test("another user gets 403 on someone else's mandate", async () => {
  const h = harness();
  const id = await createFunded(h, await login(h, "owner"));
  const other = await login(h, "intruder");
  expect((await h.call(`/api/mandates/${id}`, { cookie: other })).status).toBe(403);
  expect(
    (await h.call(`/api/mandates/${id}/close`, { method: "POST", cookie: other })).status,
  ).toBe(403);
});

test("owner refunds a bought mandate once; another user gets 403", async () => {
  const h = harness();
  const cookie = await login(h, "owner");
  const id = await createFunded(h, cookie);
  const refund = (c: string) => h.call(`/api/mandates/${id}/refund`, { method: "POST", cookie: c });
  expect((await refund(cookie)).status).toBe(409); // nothing captured yet
  h.offer.price = usd(16900);
  await h.call(`/api/mandates/${id}/check-now`, { method: "POST", cookie });
  expect((await refund(await login(h, "intruder"))).status).toBe(403);
  const res = await refund(cookie);
  expect(res.status).toBe(200);
  const view = (await res.json()) as { outcome: string; audit: { kind: string }[] };
  expect(view.outcome).toBe("refunded");
  expect(view.audit.map((e) => e.kind)).toContain("refunded");
  expect((await refund(cookie)).status).toBe(200);
  expect(h.gateway.refunds).toHaveLength(1);
});

test("the mandate list shows only your own, newest first", async () => {
  const h = harness();
  const create = async (cookie: string, over = {}) => {
    const res = await h.call("/api/mandates", { method: "POST", body: body(over), cookie });
    h.clock.advance(1000);
    return ((await res.json()) as { id: string }).id;
  };
  const owner = await login(h, "owner");
  const first = await create(owner);
  const second = await create(owner, { query: "rain jacket" });
  await create(await login(h, "intruder"));
  expect((await h.call("/api/mandates")).status).toBe(401);
  const rows = (await (await h.call("/api/mandates", { cookie: owner })).json()) as {
    id: string;
    query: string;
  }[];
  expect(rows.map((r) => r.id)).toEqual([second, first]);
  expect(rows[0]?.query).toBe("rain jacket");
});

test("simulate proposes the planted listing and is blocked with not_a_candidate", async () => {
  const h = harness();
  const cookie = await login(h);
  const id = await createFunded(h, cookie, { demoInjection: true });
  const res = await h.call(`/api/mandates/${id}/simulate`, { method: "POST", cookie });
  const { verdict } = (await res.json()) as { verdict: { kind: string; reasons: string[] } };
  expect(verdict.kind).toBe("block");
  expect(verdict.reasons).toContain("not_a_candidate");
  expect(verdict.reasons).toContain("wrong_attribute");
  expect(h.gateway.captures).toHaveLength(0);
});

test("replay plays recorded prices through check-now and labels the capture", async () => {
  const h = harness(new HistoryTracker([usd(18000), usd(16500)]));
  const cookie = await login(h);
  const id = await createFunded(h, cookie, { replay: true });
  const started = await h.call(`/api/mandates/${id}/replay/start`, { method: "POST", cookie });
  expect(await started.json()).toMatchObject({ msPerPoint: 2000, points: 2 });

  await h.call(`/api/mandates/${id}/check-now`, { method: "POST", cookie });
  expect(h.gateway.captures).toHaveLength(0);
  h.clock.advance(2000);
  const prices = (await (await h.call(`/api/mandates/${id}/prices`, { cookie })).json()) as {
    replay: boolean;
    candidates: { currentIndex: number; current: string; points: unknown[] }[];
  };
  expect(prices.replay).toBe(true);
  expect(prices.candidates[0]).toMatchObject({ currentIndex: 1, current: "165.00" });
  expect(prices.candidates[0]?.points).toHaveLength(2);

  const res = await h.call(`/api/mandates/${id}/check-now`, { method: "POST", cookie });
  const out = (await res.json()) as { mandate: { purchase: Record<string, unknown> } };
  expect(out.mandate.purchase).toMatchObject({ price: "165.00", savings: "15.00", inReplay: true });
});

test("replay start on a live mandate gives 409", async () => {
  const h = harness();
  const cookie = await login(h);
  const id = await createFunded(h, cookie);
  const res = await h.call(`/api/mandates/${id}/replay/start`, { method: "POST", cookie });
  expect(res.status).toBe(409);
});

test("the watcher tick skips the repository while no limit mandate is active", async () => {
  const h = harness();
  await h.watch.load();
  await h.watch.tick();
  expect(h.repo.gets).toBe(0);
});

test("limitPrice must be 1.00 to 5000.00 inclusive", async () => {
  const h = harness();
  const cookie = await login(h);
  const post = (limitPrice: string) =>
    h.call("/api/mandates", { method: "POST", body: body({ limitPrice }), cookie });
  for (const bad of ["0.99", "5000.01"]) {
    const res = await post(bad);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_field", field: "limitPrice" });
  }
  expect((await post("5000.00")).status).toBe(200);
  expect((await post("1.00")).status).not.toBe(400); // valid, just nothing that cheap (422)
});

test("replay is stored on the mandate and signed into its digest", async () => {
  const h = harness();
  const cookie = await login(h);
  const create = async (replay: boolean) => {
    const res = await h.call("/api/mandates", { method: "POST", body: body({ replay }), cookie });
    const { id } = (await res.json()) as { id: string };
    return (await (await h.call(`/api/mandates/${id}`, { cookie })).json()) as {
      id: string;
      replay: boolean;
      digest: string;
      audit: { message: string }[];
    };
  };
  const live = await create(false);
  const replay = await create(true);
  expect([live.replay, replay.replay]).toEqual([false, true]);
  expect((await h.repo.get(replay.id))?.replay).toBe(true);
  expect(replay.audit.map((e) => e.message).join()).not.toContain("replay requested");
  // the digest is what PayPal carries as custom_id, so it is what the buyer signs
  expect(h.gateway.orders.map((o) => o.customId)).toEqual([live.digest, replay.digest]);
});

test("a PayPal return without a session logs in first, then funds the approved order", async () => {
  const h = harness();
  const cookie = await login(h);
  const res = await h.call("/api/mandates", { method: "POST", body: body(), cookie });
  const { id } = (await res.json()) as { id: string };
  const back = `/api/paypal/return?mandate=${id}&token=order-1`;

  const ret = await h.call(back); // the session cookie is missing
  expect(ret.status).toBe(302);
  expect(ret.headers.get("location")).toBe(
    `/api/auth/paypal/start?next=${encodeURIComponent(back)}`,
  );
  expect((await h.repo.get(id))?.status).toBe("awaiting_approval");

  const start = await h.call(ret.headers.get("location") ?? "");
  const state = cookieValue(start, "entole_oauth_state");
  const next = cookieValue(start, "entole_oauth_next");
  const cb = await h.call(`/api/auth/paypal/callback?code=buyer&state=${state}`, {
    cookie: `entole_oauth_state=${state}; entole_oauth_next=${next}`,
  });
  expect(cb.headers.get("location")).toBe(back);
  const session = `entole_session=${cookieValue(cb, "entole_session")}`;
  const funded = await h.call(back, { cookie: session });
  expect(funded.headers.get("location")).toBe(`/mandates/${id}`);
  expect((await h.repo.get(id))?.status).toBe("funded");
});

test("login ignores a next that is not the PayPal return", async () => {
  const h = harness();
  const start = await h.call(`/api/auth/paypal/start?next=${encodeURIComponent("//evil.test")}`);
  expect(cookieValue(start, "entole_oauth_next")).toBe("");
  const state = cookieValue(start, "entole_oauth_state");
  const cb = await h.call(`/api/auth/paypal/callback?code=x&state=${state}`, {
    cookie: `entole_oauth_state=${state}; entole_oauth_next=%2F%2Fevil.test`,
  });
  expect(cb.headers.get("location")).toBe("/mandates/new");
});

test("refreshing the PayPal return after funding goes to the page without an error", async () => {
  const h = harness();
  const cookie = await login(h);
  const id = await createFunded(h, cookie);
  const again = await h.call(`/api/paypal/return?mandate=${id}&token=order-1`, { cookie });
  expect(again.headers.get("location")).toBe(`/mandates/${id}`);
  expect(h.gateway.voids).toHaveLength(0);
});

test("funding saves the signed taste and starts price tracking", async () => {
  const tracker = new FakePriceTracker();
  const h = harness(tracker);
  const cookie = await login(h);
  await createFunded(h, cookie);
  await new Promise((r) => setTimeout(r, 0));
  expect(tracker.started).toEqual(["p1"]);
  const me = (await (await h.call("/api/me", { cookie })).json()) as { taste: unknown };
  expect(me.taste).toEqual({ brands: [], avoid: ["white"], attributes: { Size: "10" } });
});

test("the GET view carries the rejected items and approveUrl while awaiting approval only", async () => {
  const h = harness();
  const items = [
    { product_id: "p1", merchant: "shop.example", options: { Size: "10" } },
    { product_id: "ghost", merchant: "nowhere.example", options: {} },
  ];
  h.c.model = new ScriptedAgentModel([
    {
      kind: "tools",
      calls: [{ id: "c1", name: "shortlist", argsJson: JSON.stringify({ items }) }],
    },
  ]);
  const cookie = await login(h);
  const res = await h.call("/api/mandates", { method: "POST", body: body(), cookie });
  const created = (await res.json()) as { id: string; approveUrl: string; rejected: unknown[] };
  expect(created.rejected).toHaveLength(1);

  type View = { status: string; approveUrl: string | null; rejected: { title: string }[] };
  const view = async () =>
    (await (await h.call(`/api/mandates/${created.id}`, { cookie })).json()) as View;
  const before = await view();
  expect(before.status).toBe("awaiting_approval");
  expect(before.approveUrl).toBe(created.approveUrl);
  expect(before.rejected).toEqual(created.rejected as View["rejected"]);
  expect(before.rejected[0]?.title).toBe("ghost");

  await h.call(`/api/paypal/return?mandate=${created.id}&token=order-1`, { cookie });
  const after = await view();
  expect(after.status).toBe("funded");
  expect(after.approveUrl).toBeNull();
  expect(after.rejected).toEqual(before.rejected);
});

test("skipped candidates get an accurate reason from their baseline price", async () => {
  const h = harness();
  const cookie = await login(h);
  const id = await createFunded(h, cookie);
  h.offer.price = usd(16900);
  await h.call(`/api/mandates/${id}/check-now`, { method: "POST", cookie });
  const m = await h.repo.get(id);
  if (!m) throw new Error("mandate missing");
  const other = { productId: "p2", merchant: "other.example", options: {}, title: "Cheap" };
  m.terms.candidates.push(
    { ...other, title: "Cheap", baselinePrice: usd(15000) },
    { ...other, productId: "p3", title: "Dear", baselinePrice: usd(20000) },
  );
  const res = await h.call(`/api/mandates/${id}`, { cookie });
  const view = (await res.json()) as {
    purchase: { whyThisOne: { skipped: { title: string; reasons: string[] }[] } };
  };
  expect(view.purchase.whyThisOne.skipped).toEqual([
    { title: "Cheap", reasons: ["Another item was bought first"] },
    { title: "Dear", reasons: ["Price stayed above your $170.00 limit"] },
  ]);
});

const webhook = (
  h: ReturnType<typeof harness>,
  event: unknown,
  sig = "good",
  extra: Record<string, string> = {},
) =>
  h.call("/api/paypal/webhook", {
    method: "POST",
    body: JSON.stringify(event),
    headers: {
      "paypal-transmission-sig": sig,
      "paypal-transmission-time": NOW.toISOString(),
      ...extra,
    },
  });
const approvedEvent = {
  id: "WH-1",
  event_type: "CHECKOUT.ORDER.APPROVED",
  resource: { id: "order-1" },
};

test("the PayPal webhook answers 503 when no webhook id is configured", async () => {
  const h = harness();
  const res = await webhook(h, approvedEvent);
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: "webhooks_disabled" });
});

test("the PayPal webhook rejects a bad signature with 400 and changes nothing", async () => {
  const h = harness();
  h.c.webhooks = { verify: async (headers) => headers.get("paypal-transmission-sig") === "good" };
  const cookie = await login(h);
  await h.call("/api/mandates", { method: "POST", body: body(), cookie });
  const res = await webhook(h, approvedEvent, "forged");
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid_signature" });
  expect((await h.repo.findByOrderId("order-1"))?.status).toBe("awaiting_approval");
});

test("a verified approval funds the mandate and starts tracking without the browser", async () => {
  const h = harness();
  let seenBody = "";
  h.c.webhooks = {
    verify: async (_headers, raw) => {
      seenBody = raw;
      return true;
    },
  };
  const cookie = await login(h);
  const created = await h.call("/api/mandates", { method: "POST", body: body(), cookie });
  const { id } = (await created.json()) as { id: string };
  const res = await webhook(h, approvedEvent);
  expect(res.status).toBe(200);
  expect(seenBody).toBe(JSON.stringify(approvedEvent));
  expect((await h.repo.get(id))?.status).toBe("funded");
  expect(h.watch.activeCount).toBe(1);
  // The browser return arriving later is still a clean redirect, with no second hold.
  const ret = await h.call(`/api/paypal/return?mandate=${id}&token=order-1`, { cookie });
  expect(ret.headers.get("location")).toBe(`/mandates/${id}`);
  expect((await webhook(h, approvedEvent)).status).toBe(200);
});

test("the PayPal webhook refuses a stale or unstamped delivery before asking PayPal", async () => {
  const h = harness();
  let verified = 0;
  h.c.webhooks = {
    verify: async () => {
      verified++;
      return true;
    },
  };
  const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
  for (const time of [at(-16 * 60_000), at(16 * 60_000), "not a date", ""]) {
    const res = await webhook(h, approvedEvent, "good", { "paypal-transmission-time": time });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "stale_transmission" });
  }
  expect(verified).toBe(0);
  const fresh = await webhook(h, { ...approvedEvent, id: "WH-2" }, "good", {
    "paypal-transmission-time": at(-14 * 60_000),
  });
  expect(fresh.status).toBe(200);
  expect(verified).toBe(1);
});

test("the PayPal webhook caps the body and rate-limits per forwarded IP", async () => {
  const h = harness();
  let verified = 0;
  h.c.webhooks = {
    verify: async () => {
      verified++;
      return false;
    },
  };
  const big = { ...approvedEvent, pad: "x".repeat(40_000) };
  expect((await webhook(h, big)).status).toBe(413);
  const from = (ip: string) =>
    webhook(h, approvedEvent, "good", { "x-forwarded-for": `${ip}, 10.0.0.1` });
  for (let i = 0; i < 30; i++) expect((await from("203.0.113.7")).status).toBe(400);
  const limited = await from("203.0.113.7");
  expect(limited.status).toBe(429);
  expect(await limited.json()).toEqual({ error: "rate_limited" });
  // Another client still gets through, and the limited one never reached PayPal.
  expect((await from("198.51.100.2")).status).toBe(400);
  expect(verified).toBe(31);
});

test("mandate creation stops at the per-user and the total daily caps, counted from the store", async () => {
  const h = harness();
  h.c.createCaps = { perUser: 2, total: 3 };
  const alice = await login(h, "buyer");
  const create = (cookie: string) =>
    h.call("/api/mandates", { method: "POST", body: body(), cookie });
  expect((await create(alice)).status).toBe(200);
  expect((await create(alice)).status).toBe(200);
  const capped = await create(alice);
  expect(capped.status).toBe(429);
  expect(await capped.json()).toEqual({ error: "daily_limit_reached" });
  const bob = await login(h, "other");
  expect((await create(bob)).status).toBe(200);
  const full = await create(bob);
  expect(full.status).toBe(429);
  expect(await full.json()).toEqual({ error: "service_daily_limit_reached" });
  // A day later the window has moved on.
  h.clock.advance(86_400_001);
  expect((await create(bob)).status).toBe(200);
});
