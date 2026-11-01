import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { body, createFunded, harness, login, NOW } from "./harness.ts";

const KEY = Buffer.alloc(32, 7);

type Change = { id?: string; productId?: string; price?: number; type?: string };

const event = ({
  id = "evt_1",
  productId = "p1",
  price = 160,
  type = "offer.price.changed",
}: Change = {}) =>
  JSON.stringify({
    id,
    timestamp: "2026-10-26T11:59:00Z",
    type,
    data: {
      subscription_id: "sub_1",
      subject: {
        product_id: productId,
        domain: "shop.example",
        locale: { language: "en", country: "US", currency: "USD" },
        selection: null,
      },
      previous: { price: 180, compare_at_price: null, currency: "USD" },
      current: { price, compare_at_price: null, currency: "USD" },
    },
  });

// Signs like Svix: HMAC-SHA256 over "id.timestamp.body" with the decoded secret.
const deliver = (
  h: ReturnType<typeof harness>,
  raw: string,
  signature?: string,
  ip = "203.0.113.1",
) => {
  const ts = String(Math.floor(NOW.getTime() / 1000));
  const sig = createHmac("sha256", KEY).update(`msg_1.${ts}.${raw}`).digest("base64");
  return h.call("/api/channel3/webhook", {
    method: "POST",
    body: raw,
    headers: {
      "svix-id": "msg_1",
      "svix-timestamp": ts,
      "svix-signature": signature ?? `v1,${sig}`,
      "x-forwarded-for": ip,
    },
  });
};

// A funded limit order on product p1 at $170 (the harness offer is $180), webhooks on.
const BAD = `v1,${Buffer.alloc(32).toString("base64")}`;

const quietly = async <T>(run: () => Promise<T>): Promise<T> => {
  const errors = console.error;
  console.error = () => {};
  return run().finally(() => {
    console.error = errors;
  });
};

const timeline = async (h: ReturnType<typeof harness>, cookie: string, id: string) => {
  const view = (await (await h.call(`/api/mandates/${id}`, { cookie })).json()) as {
    audit: { message: string }[];
  };
  return view.audit.map((e) => e.message);
};

const setup = async () => {
  const h = harness();
  h.c.channel3Webhooks = { key: KEY };
  const cookie = await login(h);
  const id = await createFunded(h, cookie);
  return { h, cookie, id };
};

test("price drop under the limit dispatches the mandate and answers 200", async () => {
  const { h, id } = await setup();
  const res = await deliver(h, event());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, checks: 1, notes: 0 });
  expect(h.dispatcher.dispatched).toEqual([id]);
  expect(h.dispatcher.eventIds).toEqual(["evt_1"]);
});

test("duplicate event id dispatches once", async () => {
  const { h, id } = await setup();
  expect((await deliver(h, event())).status).toBe(200);
  const again = await deliver(h, event());
  expect(again.status).toBe(200);
  expect(await again.json()).toEqual({ ok: true, duplicate: true });
  expect(h.dispatcher.dispatched).toEqual([id]);
});

test("unwatched product returns 200 and dispatches nothing", async () => {
  const { h } = await setup();
  const res = await deliver(h, event({ productId: "p_other" }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, checks: 0, notes: 0 });
  expect(h.dispatcher.dispatched).toEqual([]);
});

test("price above the limit dispatches nothing and notes it on the order once", async () => {
  const { h, cookie, id } = await setup();
  const res = await deliver(h, event({ price: 175 }));
  expect(await res.json()).toEqual({ ok: true, checks: 0, notes: 1 });
  expect(h.dispatcher.dispatched).toEqual([]);
  const note =
    "Channel3 reported a price change at shop.example: $175.00 (was $180.00), above your $170.00 limit. Still waiting.";
  expect(await timeline(h, cookie, id)).toContain(note);
  // The same price again within 6 hours adds nothing.
  const again = await deliver(h, event({ id: "evt_2", price: 175 }));
  expect(await again.json()).toEqual({ ok: true, checks: 0, notes: 0 });
  expect((await timeline(h, cookie, id)).filter((m) => m === note)).toHaveLength(1);
});

test("a failed dispatch records no note either, and the retry records both", async () => {
  const { h, cookie, id } = await setup();
  const res = await h.call("/api/mandates", {
    method: "POST",
    body: body({ limitPrice: "150.00" }),
    cookie,
  });
  const noted = ((await res.json()) as { id: string }).id;
  await h.call(`/api/paypal/return?mandate=${noted}&token=order-2`, { cookie });
  h.dispatcher.failOnce.add(id);
  expect((await quietly(() => deliver(h, event()))).status).toBe(503);
  expect(await timeline(h, cookie, noted)).not.toContain(
    "Channel3 reported a price change at shop.example: $160.00 (was $180.00), above your $150.00 limit. Still waiting.",
  );
  const retry = await deliver(h, event());
  expect(await retry.json()).toEqual({ ok: true, checks: 1, notes: 1 });
  expect(await timeline(h, cookie, noted)).toContain(
    "Channel3 reported a price change at shop.example: $160.00 (was $180.00), above your $150.00 limit. Still waiting.",
  );
});

test("failed dispatch returns 503 and is not remembered", async () => {
  const { h, id } = await setup();
  h.dispatcher.failOnce.add(id);
  const errors = console.error;
  console.error = () => {};
  const failed = await deliver(h, event()).finally(() => {
    console.error = errors;
  });
  expect(failed.status).toBe(503);
  expect(await failed.json()).toMatchObject({ error: "dispatch_failed" });
  const retry = await deliver(h, event());
  expect(await retry.json()).toEqual({ ok: true, checks: 1, notes: 0 });
  expect(h.dispatcher.dispatched).toEqual([id]);
});

test("bad signature 401 and nothing dispatched", async () => {
  const { h } = await setup();
  const res = await deliver(h, event(), `v1,${Buffer.alloc(32).toString("base64")}`);
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ error: "invalid_signature" });
  const bare = await h.call("/api/channel3/webhook", { method: "POST", body: event() });
  expect(bare.status).toBe(400);
  expect(await bare.json()).toMatchObject({ error: "missing_signature_headers" });
  expect(h.dispatcher.dispatched).toEqual([]);
});

test("a body that is not JSON answers 400 invalid_json", async () => {
  const { h } = await setup();
  const res = await deliver(h, "{not json");
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: "invalid_json" });
  // Signed but never parseable, so Svix is told to stop retrying.
  expect(res.headers.get("webhook-delivery")).toBe("abort-message");
});

test("disabled without a secret 503", async () => {
  const h = harness();
  const res = await deliver(h, event());
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ error: "channel3_webhooks_disabled" });
});

test("the mandate timeline shows the Channel3 entry", async () => {
  const { h, cookie, id } = await setup();
  expect((await deliver(h, event())).status).toBe(200);
  const view = (await (await h.call(`/api/mandates/${id}`, { cookie })).json()) as {
    audit: { message: string }[];
  };
  expect(view.audit.map((e) => e.message)).toContain(
    "Channel3 reported a price change at shop.example, checking now",
  );
});

test("one failed dispatch of two answers 503 and the retry dispatches both", async () => {
  const { h, cookie, id } = await setup();
  // createFunded returns with PayPal order-1, so the second order is funded with order-2.
  const res = await h.call("/api/mandates", { method: "POST", body: body(), cookie });
  const second = ((await res.json()) as { id: string }).id;
  await h.call(`/api/paypal/return?mandate=${second}&token=order-2`, { cookie });
  h.dispatcher.failOnce.add(second);
  const errors = console.error;
  console.error = () => {};
  const failed = await deliver(h, event()).finally(() => {
    console.error = errors;
  });
  expect(failed.status).toBe(503);
  const retry = await deliver(h, event());
  expect(await retry.json()).toEqual({ ok: true, checks: 2, notes: 0 });
  expect(h.dispatcher.dispatched.filter((d) => d === second)).toHaveLength(1);
  expect(h.dispatcher.dispatched.filter((d) => d === id)).toHaveLength(2);
});

test("the Channel3 limiter answers 429 once its minute is spent", async () => {
  const h = harness();
  h.c.channel3Webhooks = { key: KEY };
  for (let i = 0; i < 600; i++) expect((await deliver(h, event())).status).toBe(200);
  const res = await deliver(h, event());
  expect(res.status).toBe(429);
  expect(await res.json()).toMatchObject({ error: "rate_limited" });
});

test("a failed dispatch writes no timeline entry", async () => {
  const { h, cookie, id } = await setup();
  h.dispatcher.failOnce.add(id);
  expect((await quietly(() => deliver(h, event()))).status).toBe(503);
  expect(await timeline(h, cookie, id)).not.toContain(
    "Channel3 reported a price change at shop.example, checking now",
  );
});

test("a failed timeline write after dispatch still answers 200 and is remembered", async () => {
  const { h, id } = await setup();
  const append = h.c.repo.appendAudit.bind(h.c.repo);
  h.c.repo.appendAudit = async () => {
    throw new Error("db down");
  };
  const res = await quietly(() => deliver(h, event()));
  h.c.repo.appendAudit = append;
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, checks: 1, notes: 0 });
  // Svix's retry of the same event must not start the check a second time.
  expect(await (await deliver(h, event())).json()).toEqual({ ok: true, duplicate: true });
  expect(h.dispatcher.dispatched).toEqual([id]);
});

test("a failed note write still records the wakes, answers 200 and is remembered", async () => {
  const { h, cookie, id } = await setup();
  const res = await h.call("/api/mandates", {
    method: "POST",
    body: body({ limitPrice: "150.00" }),
    cookie,
  });
  const noted = ((await res.json()) as { id: string }).id;
  await h.call(`/api/paypal/return?mandate=${noted}&token=order-2`, { cookie });
  const append = h.c.repo.appendAudit.bind(h.c.repo);
  h.c.repo.appendAudit = (mandateId, e) =>
    e.kind === "channel3_noted" ? Promise.reject(new Error("db down")) : append(mandateId, e);
  const answered = await quietly(() => deliver(h, event()));
  h.c.repo.appendAudit = append;
  expect(answered.status).toBe(200);
  expect(await answered.json()).toEqual({ ok: true, checks: 1, notes: 0 });
  expect(await timeline(h, cookie, id)).toContain(
    "Channel3 reported a price change at shop.example, checking now",
  );
  expect(await (await deliver(h, event())).json()).toEqual({ ok: true, duplicate: true });
});

test("an unknown event type answers 200 ignored and dispatches nothing", async () => {
  const { h } = await setup();
  const logged: unknown[][] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => logged.push(args);
  const res = await deliver(h, event({ type: "offer.renamed" })).finally(() => {
    console.log = log;
  });
  expect(logged).toEqual([["channel3 event evt_1 (offer.renamed) ignored: unhandled type"]]);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, ignored: true });
  expect(h.dispatcher.dispatched).toEqual([]);
  const again = await deliver(h, event({ type: "offer.renamed" }));
  expect(await again.json()).toEqual({ ok: true, duplicate: true });
});

test("a deleted offer answers 200 ignored", async () => {
  const { h } = await setup();
  const res = await deliver(h, event({ type: "offer.deleted" }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, ignored: true });
  expect(h.dispatcher.dispatched).toEqual([]);
});

test("a structurally broken event answers 400 invalid_event", async () => {
  const { h } = await setup();
  const logged: unknown[][] = [];
  const errors = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  const res = await deliver(
    h,
    JSON.stringify({ id: "evt_1", type: "offer.price.changed", extra: "payload" }),
  ).finally(() => {
    console.error = errors;
  });
  // Id and type only, never the payload.
  expect(logged).toEqual([
    ["channel3 event evt_1 (offer.price.changed) is invalid, delivery aborted"],
  ]);
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: "invalid_event" });
  // Svix would retry it for about 30 hours; it can never parse.
  expect(res.headers.get("webhook-delivery")).toBe("abort-message");
});

test("bad signatures are limited per IP and do not use up the Channel3 window", async () => {
  const { h, id } = await setup();
  for (let i = 0; i < 30; i++) expect((await deliver(h, event(), BAD)).status).toBe(401);
  const limited = await deliver(h, event(), BAD);
  expect(limited.status).toBe(429);
  expect(await limited.json()).toMatchObject({ error: "rate_limited" });
  expect((await deliver(h, event(), BAD, "203.0.113.2")).status).toBe(401);
  // A signed delivery from the limited address still goes through.
  const res = await deliver(h, event());
  expect(await res.json()).toEqual({ ok: true, checks: 1, notes: 0 });
  expect(h.dispatcher.dispatched).toEqual([id]);
});

test("Channel3 forgeries do not use up the PayPal webhook's per-IP window", async () => {
  const { h } = await setup();
  h.c.webhooks = { verify: async () => false };
  for (let i = 0; i < 30; i++) expect((await deliver(h, event(), BAD)).status).toBe(401);
  const paypal = await h.call("/api/paypal/webhook", {
    method: "POST",
    body: JSON.stringify({ id: "WH-1", event_type: "CHECKOUT.ORDER.APPROVED", resource: {} }),
    headers: {
      "paypal-transmission-sig": "bad",
      "paypal-transmission-time": NOW.toISOString(),
      "x-forwarded-for": "203.0.113.1",
    },
  });
  expect(paypal.status).toBe(400);
  expect(await paypal.json()).toMatchObject({ error: "invalid_signature" });
});
