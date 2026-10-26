// Render cron entry point: starts the watchLimitOrders task and waits for it.
// Needs RENDER_API_KEY and WORKFLOW_SLUG (the workflow service's slug, its name by default).
import { readEnv } from "@entole/shared-kernel";
import { Render } from "@renderinc/sdk";
import { parseWatcherMode } from "../jobs/watcher-mode.ts";

// The API's timer and this workflow must never both run, so the schedule does nothing in timer mode.
if (parseWatcherMode(process.env.WATCHER_MODE) !== "workflow") {
  console.log("WATCHER_MODE is not workflow: the API's timer runs the watcher, nothing to start");
  process.exit(0);
}

const run = await new Render().workflows.runTask(
  `${readEnv("WORKFLOW_SLUG")}/watchLimitOrders`,
  [],
);
console.log(JSON.stringify(run));
if (run.status === "failed" || run.status === "canceled") process.exit(1);
