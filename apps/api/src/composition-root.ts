import {
  type ApiTokenRepository,
  type IdempotencyStore,
  type IdentityProvider,
  PayPalIdentity,
  PostgresApiTokenRepository,
  PostgresIdempotencyStore,
  PostgresSessionRepository,
  PostgresUserRepository,
  type SessionRepository,
  type UserRepository,
} from "@entole/identity";
import {
  Channel3PriceTracker,
  type MandateCheckDispatcher,
  type PriceTracker,
} from "@entole/limit-order";
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
import { type Clock, CryptoIds, type IdGenerator, SystemClock } from "@entole/shared-kernel";
import {
  type AgentModel,
  Channel3Search,
  type ChatModel,
  GroqAgentModel,
  GroqChatModel,
  GroqKeyHealth,
  type KeyHealthCheck,
  PostgresTasteRepository,
  type TasteRepository,
} from "@entole/shopping";
import { Render } from "@renderinc/sdk";
import { SQL } from "bun";
import { parseSvixSecret } from "./http/svix.ts";
import { parseWatcherMode, type WatcherMode } from "./jobs/watcher-mode.ts";
import { InProcessDispatcher, RenderWorkflowDispatcher } from "./workflows/dispatchers.ts";
import { checkMandate } from "./workflows/watch-tasks.ts";

// Everything the routes and the watcher need. Tests build one from the @entole/testing fakes.
export type Container = {
  repo: MandateRepository;
  lock: MandateLock; // every mandate writer goes through it
  gateway: PaymentGateway;
  search: ProductSearch;
  model: AgentModel;
  chat: ChatModel; // the dashboard assistant's model
  groqHealth: KeyHealthCheck; // which Groq keys answer, for GET /api/ops/groq
  opsToken: string | null; // null when OPS_TOKEN is not set: the ops route answers 404
  tracker: PriceTracker;
  identity: IdentityProvider;
  users: UserRepository;
  sessions: SessionRepository;
  apiTokens: ApiTokenRepository;
  idempotency: IdempotencyStore; // answers kept per caller and Idempotency-Key for a day
  tastes: TasteRepository;
  clock: Clock;
  ids: IdGenerator;
  webhooks: WebhookVerifier | null; // null when PAYPAL_WEBHOOK_ID is not set
  channel3Webhooks: { key: Buffer } | null; // null when CHANNEL3_WEBHOOK_SECRET is not set
  dispatcher: MandateCheckDispatcher; // starts one limit order check when Channel3 reports a change
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

type Env = Record<string, string | undefined>;

const readEnv = (name: string, env: Env = process.env): string => {
  const value = env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
};

const positive = (env: Env, name: string, fallback: number, integer = false): number => {
  const raw = env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (integer && !Number.isInteger(n)) throw new Error(`${name} must be a positive integer`);
  if (!(n > 0)) throw new Error(`${name} must be a positive ${integer ? "integer" : "number"}`);
  return n;
};

// Who runs the price watcher, and how to reach the Render workflow when it is not the API's timer.
export type WatcherConfig = {
  watcherMode: WatcherMode;
  workflow: { slug: string; renderApiKey: string } | null; // set in workflow mode only
};

export type Config = WatcherConfig & {
  port: number;
  watchIntervalMin: number;
  databaseUrl: string;
  // Mandates created in the last 24 hours, per user and in total.
  createCaps: { perUser: number; total: number };
};

// The hourly cron reads only this part: it has no DATABASE_URL.
export const readWatcherConfig = (env: Env = process.env): WatcherConfig => {
  const watcherMode = parseWatcherMode(env.WATCHER_MODE);
  return {
    watcherMode,
    workflow:
      watcherMode === "workflow"
        ? { slug: readEnv("WORKFLOW_SLUG", env), renderApiKey: readEnv("RENDER_API_KEY", env) }
        : null,
  };
};

export const readConfig = (env: Env = process.env): Config => ({
  port: positive(env, "PORT", 8787),
  watchIntervalMin: positive(env, "WATCH_INTERVAL_MIN", 60),
  ...readWatcherConfig(env),
  databaseUrl: readEnv("DATABASE_URL", env),
  createCaps: {
    perUser: positive(env, "MANDATE_DAILY_LIMIT_PER_USER", 30, true),
    total: positive(env, "MANDATE_DAILY_LIMIT_TOTAL", 500, true),
  },
});

// Unlocks GET /api/ops/groq; short values could be guessed, so refuse to start with one.
const opsToken = (): string | null => {
  const raw = process.env.OPS_TOKEN;
  if (!raw) return null;
  if (raw.length < 32) throw new Error("OPS_TOKEN must be at least 32 characters");
  return raw;
};

// Production wiring: real adapters, Postgres repositories, CryptoIds. Never fakes or SequentialIds.
export const productionContainer = (sql: SQL, config: Config): Container => {
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
  // The Groq keys configured for this deployment, used in turn.
  const extraGroqKeys = ["GROQ_API_KEY_2", "GROQ_API_KEY_3", "GROQ_API_KEY_4"].flatMap(
    (name) => process.env[name] || [],
  );
  const groq = {
    apiKeys: [readEnv("GROQ_API_KEY"), ...extraGroqKeys] as const,
    model: process.env.GROQ_MODEL || undefined,
  };
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  const channel3Secret = process.env.CHANNEL3_WEBHOOK_SECRET;
  const container: Container = {
    repo: new PostgresMandateRepository(sql),
    // Its own small pool, so lock holders never starve the queries they wait on. The API and the
    // workflow worker both build this container, so they lock the same Postgres keys.
    lock: new PostgresMandateLock(new SQL(config.databaseUrl, { max: 4 })),
    gateway,
    search: new Channel3Search(channel3),
    model: new GroqAgentModel(groq),
    chat: new GroqChatModel(groq),
    groqHealth: new GroqKeyHealth(groq),
    opsToken: opsToken(),
    tracker: new Channel3PriceTracker(channel3),
    identity: new PayPalIdentity({ ...paypal, publicBaseUrl }),
    users: new PostgresUserRepository(sql),
    sessions: new PostgresSessionRepository(sql),
    apiTokens: new PostgresApiTokenRepository(sql),
    idempotency: new PostgresIdempotencyStore(sql),
    tastes: new PostgresTasteRepository(sql),
    clock: new SystemClock(),
    ids: new CryptoIds(),
    webhooks: webhookId ? new PayPalSignatureVerifier({ webhookId }) : null,
    // Decoded at boot, so a mangled secret stops the deploy instead of failing every delivery.
    channel3Webhooks: channel3Secret ? { key: parseSvixSecret(channel3Secret) } : null,
    // Same switch as the watcher: in workflow mode every check runs as a Render Workflows task.
    dispatcher: config.workflow
      ? new RenderWorkflowDispatcher(
          config.workflow.slug,
          new Render({ token: config.workflow.renderApiKey }),
        )
      : new InProcessDispatcher((id) => checkMandate(container, id)),
    callbacks: new PayPalSignatureVerifier(),
    publicBaseUrl,
    shippingCallback: process.env.PAYPAL_SHIPPING_CALLBACK === "on",
    createCaps: config.createCaps,
    // Browsers refuse Secure cookies over plain http, so local dev on http://localhost drops it.
    secureCookies: !publicBaseUrl.startsWith("http://localhost"),
  };
  return container;
};
