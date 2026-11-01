import { migrate } from "@entole/mandate";
import { SQL } from "bun";
import { productionContainer, readConfig } from "./composition-root.ts";
import { createRouter } from "./http/router.ts";
import { LimitWatch } from "./jobs/limit-watch.ts";

const config = readConfig();

const sql = new SQL(config.databaseUrl);
await migrate(sql);
const container = productionContainer(sql, config);
if (!container.webhooks) console.warn("PAYPAL_WEBHOOK_ID is not set: PayPal webhooks answer 503");
if (!container.channel3Webhooks)
  console.warn("CHANNEL3_WEBHOOK_SECRET is not set: Channel3 webhooks answer 503");
const watch = new LimitWatch(container);
await watch.load();

const server = Bun.serve({
  port: config.port,
  // Creating a mandate runs several Groq and Channel3 calls in a row; Bun's default 10 s idle
  // timeout would drop the request before the response starts.
  idleTimeout: 120,
  maxRequestBodySize: 64 * 1024,
  fetch: createRouter(container, watch),
});
console.log(
  `Entole API listening on port ${server.port} (${watch.activeCount} active limit orders)`,
);

// In workflow mode the Render Workflows task runs the watcher, so the API starts no timer; its
// cron (render.yaml) starts it at the top of every hour.
if (config.watcherMode === "workflow") watch.setTickSchedule(new Date(0), 60 * 60_000);
else {
  // One run at boot catches up after a restart; then every WATCH_INTERVAL_MIN.
  // The tick skips all DB work while no limit mandate is active, so Neon can sleep.
  const tick = () => void watch.tick().catch((err: unknown) => console.error(err));
  tick();
  setInterval(tick, config.watchIntervalMin * 60_000);
  watch.setTickSchedule(container.clock.now(), config.watchIntervalMin * 60_000);
}
