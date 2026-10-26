import { migrate } from "@entole/mandate";
import { readEnv } from "@entole/shared-kernel";
import { SQL } from "bun";
import { productionContainer } from "./composition-root.ts";
import { createRouter } from "./http/router.ts";
import { LimitWatch } from "./jobs/limit-watch.ts";
import { parseWatcherMode } from "./jobs/watcher-mode.ts";

const positive = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!(n > 0)) throw new Error(`${name} must be a positive number`);
  return n;
};

const port = positive("PORT", 8787);
const watchIntervalMin = positive("WATCH_INTERVAL_MIN", 60);
const watcherMode = parseWatcherMode(process.env.WATCHER_MODE);

const sql = new SQL(readEnv("DATABASE_URL"));
await migrate(sql);
const container = productionContainer(sql);
if (!container.webhooks) console.warn("PAYPAL_WEBHOOK_ID is not set: PayPal webhooks answer 503");
const watch = new LimitWatch(container);
await watch.load();

const server = Bun.serve({
  port,
  // Creating a mandate runs several Groq and Channel3 calls in a row; Bun's default 10 s idle
  // timeout would drop the request before the response starts.
  idleTimeout: 120,
  maxRequestBodySize: 64 * 1024,
  fetch: createRouter(container, watch),
});
console.log(
  `Entole API listening on port ${server.port} (${watch.activeCount} active limit orders)`,
);

// In workflow mode the Render Workflows task runs the watcher, so the API starts no timer.
if (watcherMode === "timer") {
  // One run at boot catches up after a restart; then every WATCH_INTERVAL_MIN.
  // The tick skips all DB work while no limit mandate is active, so Neon can sleep.
  const tick = () => void watch.tick().catch((err: unknown) => console.error(err));
  tick();
  setInterval(tick, watchIntervalMin * 60_000);
}
