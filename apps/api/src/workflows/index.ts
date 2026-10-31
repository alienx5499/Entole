// Render Workflows entry point. Start command: bun apps/api/src/workflows/index.ts
import { readEnv } from "@entole/shared-kernel";
import { type TaskContext, task } from "@renderinc/sdk/workflows";
import { SQL } from "bun";
import { type Container, productionContainer } from "../composition-root.ts";
import { checkMandate, watchLimitOrders } from "./watch-tasks.ts";

// Built on first use, so registering the tasks needs no environment.
let container: Container | undefined;
const getContainer = (): Container => {
  container ??= productionContainer(new SQL(readEnv("DATABASE_URL")));
  return container;
};

const retry = { maxRetries: 2, waitDurationMs: 5000, backoffScaling: 2 };

const checkMandateTask = task(
  // A few catalog lookups and PayPal calls; a hung upstream call times out and retries.
  { name: "checkMandate", retry, timeoutSeconds: 120 },
  // `eventId` is set when a Channel3 event started the run; the hourly parent passes none.
  async function checkMandateRun(ctx: TaskContext, mandateId: string, eventId?: string) {
    return checkMandate(getContainer(), mandateId, { eventId, taskRunId: ctx.metadata.taskRunId });
  },
);

task(
  { name: "watchLimitOrders", timeoutSeconds: 900 },
  async function watchLimitOrdersRun(ctx: TaskContext) {
    return watchLimitOrders(getContainer(), (id) => ctx.run(checkMandateTask, id));
  },
);
