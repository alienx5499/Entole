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
  { name: "checkMandate", retry },
  async function checkMandateRun(_ctx: TaskContext, mandateId: string) {
    return checkMandate(getContainer(), mandateId);
  },
);

task({ name: "watchLimitOrders" }, async function watchLimitOrdersRun(ctx: TaskContext) {
  return watchLimitOrders(getContainer(), (id) => ctx.run(checkMandateTask, id));
});
