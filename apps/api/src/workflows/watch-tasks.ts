import { runWatcherTick } from "@entole/limit-order";
import type { Container } from "../composition-root.ts";

export type CheckResult = { checked: number; captured: string[] };
export type WatchSummary = {
  mandates: number;
  checked: number;
  captured: string[];
  failed: number;
};

// One mandate through the same tick the timer runs, always on live prices (replays live in the API's memory).
export const checkMandate = async (c: Container, mandateId: string): Promise<CheckResult> => {
  const { checked, captured } = await runWatcherTick({ ...c, prices: c.search }, { mandateId });
  return { checked, captured };
};

// The parent task: list the funded limit mandates, run one child per mandate, and sum the results.
// `run` is ctx.run(checkMandateTask, id) on Render, so each mandate gets its own instance.
// One failed child is counted and does not stop the others. Nothing funded means no child runs.
export const watchLimitOrders = async (
  c: Container,
  run: (mandateId: string) => Promise<CheckResult>,
): Promise<WatchSummary> => {
  const ids = (await c.repo.listFundedLimit()).map((m) => m.id);
  const settled = await Promise.allSettled(ids.map(run));
  const summary: WatchSummary = { mandates: ids.length, checked: 0, captured: [], failed: 0 };
  for (const [i, r] of settled.entries()) {
    if (r.status === "rejected") {
      summary.failed++;
      console.error(`watch ${ids[i]} failed`, r.reason);
      continue;
    }
    summary.checked += r.value.checked;
    summary.captured.push(...r.value.captured);
  }
  return summary;
};
