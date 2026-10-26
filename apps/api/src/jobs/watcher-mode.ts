// Who runs the price watcher: the API's own timer (default) or the Render Workflows task.
export type WatcherMode = "timer" | "workflow";

export const parseWatcherMode = (raw: string | undefined): WatcherMode => {
  if (!raw || raw === "timer") return "timer";
  if (raw === "workflow") return "workflow";
  throw new Error(`WATCHER_MODE must be "timer" or "workflow", got "${raw}"`);
};
