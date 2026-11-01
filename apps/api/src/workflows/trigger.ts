// Render cron entry point: starts the watchLimitOrders task and waits for it.
// Needs RENDER_API_KEY and WORKFLOW_SLUG (the workflow service's slug, its name by default).
import { Render } from "@renderinc/sdk";
import { readWatcherConfig } from "../composition-root.ts";

// The API's timer and this workflow must never both run, so the schedule does nothing in timer mode.
const { workflow } = readWatcherConfig();
if (!workflow) {
  console.log("WATCHER_MODE is not workflow: the API's timer runs the watcher, nothing to start");
  process.exit(0);
}

const run = await new Render({ token: workflow.renderApiKey }).workflows.runTask(
  `${workflow.slug}/watchLimitOrders`,
  [],
);
console.log(JSON.stringify(run));
if (run.status === "failed" || run.status === "canceled") process.exit(1);
