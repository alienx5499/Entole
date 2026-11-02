// Shared in-memory harness for the API route tests.
import { expect } from "bun:test";
import { RandomApiTokenGenerator } from "@entole/identity";
import type { PriceTracker } from "@entole/limit-order";
import { InMemoryMandateLock, type ProductSummary, type ResolvedOffer } from "@entole/mandate";
import { type Money, usd } from "@entole/shared-kernel";
import {
  FakeIdentityProvider,
  FakeMandateCheckDispatcher,
  FakePaymentGateway,
  FakePriceTracker,
  FakeProductSearch,
  FixedClock,
  InMemoryApiTokenRepository,
  InMemoryIdempotencyStore,
  InMemoryMandateRepository,
  InMemorySessionRepository,
  InMemoryTasteRepository,
  InMemoryUserRepository,
  RecordingLogger,
  ScriptedAgentModel,
  ScriptedChatModel,
  SequentialIds,
} from "@entole/testing";
import type { Container } from "../src/composition-root.ts";
import { createRouter } from "../src/http/router.ts";
import { LimitWatch } from "../src/jobs/limit-watch.ts";

export const NOW = new Date("2026-10-26T12:00:00Z");
const BASE = "http://api.test";

export class HistoryTracker implements PriceTracker {
  constructor(private readonly prices: Money[]) {}
  async start(_productId: string) {}
  async history(_productId: string, _days: number) {
    return this.prices.map((price, i) => ({
      at: new Date(NOW.getTime() - (9 - i) * 86_400_000),
      price,
    }));
  }
}

class CountingRepo extends InMemoryMandateRepository {
  gets = 0;
  override async get(id: string) {
    this.gets++;
    return super.get(id);
  }
}

export const harness = (tracker: PriceTracker = new FakePriceTracker()) => {
  const offer: ResolvedOffer = {
    productId: "p1",
    title: "Trail Runner 2",
    merchant: "shop.example",
    brand: "Acme",
    price: usd(18000),
    attributes: { Size: "10" },
    url: "https://shop.example/p1",
    inStock: true,
    condition: "new",
  };
  const summary: ProductSummary = {
    productId: "p1",
    title: offer.title,
    offers: [{ merchant: "shop.example", price: offer.price }],
    options: { Size: ["10", "11"] },
    description: "",
  };
  const shortlist = JSON.stringify({
    items: [{ product_id: "p1", merchant: "shop.example", options: { Size: "10" } }],
  });
  const clock = new FixedClock(NOW);
  const gateway = new FakePaymentGateway();
  const repo = new CountingRepo();
  const dispatcher = new FakeMandateCheckDispatcher();
  const c: Container = {
    repo,
    lock: new InMemoryMandateLock(),
    gateway,
    search: new FakeProductSearch([summary], [offer]),
    model: new ScriptedAgentModel([
      { kind: "tools", calls: [{ id: "c1", name: "shortlist", argsJson: shortlist }] },
    ]),
    chat: new ScriptedChatModel(),
    groqHealth: { check: async () => [] },
    opsToken: null,
    tracker,
    identity: new FakeIdentityProvider(),
    users: new InMemoryUserRepository(),
    sessions: new InMemorySessionRepository(),
    apiTokens: new InMemoryApiTokenRepository(),
    tokenGenerator: new RandomApiTokenGenerator(),
    idempotency: new InMemoryIdempotencyStore(),
    tastes: new InMemoryTasteRepository(),
    clock,
    ids: new SequentialIds(),
    logger: new RecordingLogger(),
    webhooks: null,
    channel3Webhooks: null,
    dispatcher,
    callbacks: { verify: async (headers) => headers.get("paypal-transmission-sig") === "good" },
    publicBaseUrl: "https://entole.test",
    shippingCallback: true,
    createCaps: { perUser: 30, total: 500 },
    secureCookies: true,
  };
  const watch = new LimitWatch(c);
  const handle = createRouter(c, watch);
  const call = (path: string, init: RequestInit & { cookie?: string } = {}) =>
    handle(
      new Request(`${BASE}${path}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          ...(init.cookie ? { cookie: init.cookie } : {}),
          "content-type": "application/json",
        },
      }),
    );
  return { c, repo, watch, call, offer, clock, gateway, dispatcher };
};

export const cookieValue = (res: Response, name: string): string => {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? "";
  return line.slice(name.length + 1).split(";")[0] ?? "";
};

export const login = async (h: ReturnType<typeof harness>, code = "buyer"): Promise<string> => {
  const start = await h.call("/api/auth/paypal/start");
  const state = cookieValue(start, "entole_oauth_state");
  const cb = await h.call(`/api/auth/paypal/callback?code=${code}&state=${state}`, {
    cookie: `entole_oauth_state=${state}`,
  });
  expect(cb.status).toBe(302);
  return `entole_session=${cookieValue(cb, "entole_session")}`;
};

export const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    query: "trail running shoes",
    brands: [],
    avoid: ["white"],
    requiredAttributes: { Size: "10" },
    limitPrice: "170.00",
    validDays: 3,
    demoInjection: false,
    replay: false,
    ...over,
  });

// Creates and funds a mandate, returning its id.
export const createFunded = async (h: ReturnType<typeof harness>, cookie: string, over = {}) => {
  const res = await h.call("/api/mandates", { method: "POST", body: body(over), cookie });
  expect(res.status).toBe(200);
  const created = (await res.json()) as { id: string };
  const ret = await h.call(`/api/paypal/return?mandate=${created.id}&token=order-1`, { cookie });
  expect(ret.headers.get("location")).toBe(`/mandates/${created.id}`);
  return created.id;
};
