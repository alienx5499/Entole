import {
  type ApiTokenRepository,
  type IdentityProvider,
  PayPalIdentity,
  PostgresApiTokenRepository,
  PostgresSessionRepository,
  PostgresUserRepository,
  type SessionRepository,
  type UserRepository,
} from "@entole/identity";
import { Channel3PriceTracker, type PriceTracker } from "@entole/limit-order";
import {
  type MandateLock,
  type MandateRepository,
  type PaymentGateway,
  PayPalGateway,
  PayPalSignatureVerifier,
  PostgresMandateLock,
  PostgresMandateRepository,
  type ProductSearch,
  type WebhookVerifier,
} from "@entole/mandate";
import {
  type Clock,
  CryptoIds,
  type IdGenerator,
  readEnv,
  SystemClock,
} from "@entole/shared-kernel";
import {
  type AgentModel,
  Channel3Search,
  type ChatModel,
  GroqAgentModel,
  GroqChatModel,
  PostgresTasteRepository,
  type TasteRepository,
} from "@entole/shopping";
import { SQL } from "bun";

// Everything the routes and the watcher need. Tests build one from the @entole/testing fakes.
export type Container = {
  repo: MandateRepository;
  lock: MandateLock; // every mandate writer goes through it
  gateway: PaymentGateway;
  search: ProductSearch;
  model: AgentModel;
  chat: ChatModel; // the dashboard assistant's model
  tracker: PriceTracker;
  identity: IdentityProvider;
  users: UserRepository;
  sessions: SessionRepository;
  apiTokens: ApiTokenRepository;
  tastes: TasteRepository;
  clock: Clock;
  ids: IdGenerator;
  webhooks: WebhookVerifier | null; // null when PAYPAL_WEBHOOK_ID is not set
  callbacks: WebhookVerifier; // PayPal's order update callback, signed without a webhook id
  publicBaseUrl: string; // no trailing slash
  // PayPal's ship-to callback on new orders. Off unless PAYPAL_SHIPPING_CALLBACK=on, so it is
  // switched on only after one sandbox approval has gone through it on the deployed API.
  shippingCallback: boolean;
  // Mandates created in the last 24 hours, counted from the database so a restart keeps them.
  createCaps: { perUser: number; total: number };
  secureCookies: boolean;
};

const SANDBOX_API = "https://api-m.sandbox.paypal.com";

const positiveInt = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
};

// Production wiring: real adapters, Postgres repositories, CryptoIds. Never fakes or SequentialIds.
export const productionContainer = (sql: SQL): Container => {
  const paypalBase = readEnv("PAYPAL_API_BASE").replace(/\/+$/, "");
  if (paypalBase !== SANDBOX_API) throw new Error(`PAYPAL_API_BASE must be ${SANDBOX_API}`);
  // Normalized once here, so every redirect and return URL is built without a double slash.
  const publicBaseUrl = readEnv("PUBLIC_BASE_URL").replace(/\/+$/, "");
  const paypal = {
    clientId: readEnv("PAYPAL_CLIENT_ID"),
    clientSecret: readEnv("PAYPAL_CLIENT_SECRET"),
    baseUrl: paypalBase,
  };
  const channel3 = { apiKey: readEnv("CHANNEL3_API_KEY") };
  const gateway = new PayPalGateway(paypal);
  const groq = { apiKey: readEnv("GROQ_API_KEY"), model: process.env.GROQ_MODEL || undefined };
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  return {
    repo: new PostgresMandateRepository(sql),
    // Its own small pool, so lock holders never starve the queries they wait on. The API and the
    // workflow worker both build this container, so they lock the same Postgres keys.
    lock: new PostgresMandateLock(new SQL(readEnv("DATABASE_URL"), { max: 4 })),
    gateway,
    search: new Channel3Search(channel3),
    model: new GroqAgentModel(groq),
    chat: new GroqChatModel(groq),
    tracker: new Channel3PriceTracker(channel3),
    identity: new PayPalIdentity({ ...paypal, publicBaseUrl }),
    users: new PostgresUserRepository(sql),
    sessions: new PostgresSessionRepository(sql),
    apiTokens: new PostgresApiTokenRepository(sql),
    tastes: new PostgresTasteRepository(sql),
    clock: new SystemClock(),
    ids: new CryptoIds(),
    webhooks: webhookId ? new PayPalSignatureVerifier({ webhookId }) : null,
    callbacks: new PayPalSignatureVerifier(),
    publicBaseUrl,
    shippingCallback: process.env.PAYPAL_SHIPPING_CALLBACK === "on",
    createCaps: {
      perUser: positiveInt("MANDATE_DAILY_LIMIT_PER_USER", 30),
      total: positiveInt("MANDATE_DAILY_LIMIT_TOTAL", 500),
    },
    // Browsers refuse Secure cookies over plain http, so local dev on http://localhost drops it.
    secureCookies: !publicBaseUrl.startsWith("http://localhost"),
  };
};
