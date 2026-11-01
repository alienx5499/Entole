import { expect, test } from "bun:test";
import { readConfig, readWatcherConfig } from "../src/composition-root.ts";

const base = { DATABASE_URL: "postgres://db" };

test("config falls back to the documented defaults", () => {
  expect(readConfig(base)).toEqual({
    port: 8787,
    watchIntervalMin: 60,
    watcherMode: "timer",
    workflow: null,
    databaseUrl: "postgres://db",
    createCaps: { perUser: 30, total: 500 },
  });
});

test("config reads every setting it is given", () => {
  const config = readConfig({
    ...base,
    PORT: "9000",
    WATCH_INTERVAL_MIN: "0.5",
    WATCHER_MODE: "workflow",
    WORKFLOW_SLUG: "entole-watcher",
    RENDER_API_KEY: "rnd_key",
    MANDATE_DAILY_LIMIT_PER_USER: "5",
    MANDATE_DAILY_LIMIT_TOTAL: "50",
  });
  expect(config).toEqual({
    port: 9000,
    watchIntervalMin: 0.5,
    watcherMode: "workflow",
    workflow: { slug: "entole-watcher", renderApiKey: "rnd_key" },
    databaseUrl: "postgres://db",
    createCaps: { perUser: 5, total: 50 },
  });
});

test("config refuses values that are not positive", () => {
  for (const PORT of ["0", "-1", "abc"])
    expect(() => readConfig({ ...base, PORT })).toThrow("PORT must be a positive number");
  expect(() => readConfig({ ...base, WATCH_INTERVAL_MIN: "0" })).toThrow(
    "WATCH_INTERVAL_MIN must be a positive number",
  );
  for (const MANDATE_DAILY_LIMIT_PER_USER of ["1.5", "0", "x"])
    expect(() => readConfig({ ...base, MANDATE_DAILY_LIMIT_PER_USER })).toThrow(
      "MANDATE_DAILY_LIMIT_PER_USER must be a positive integer",
    );
  expect(() => readConfig({ ...base, MANDATE_DAILY_LIMIT_TOTAL: "-3" })).toThrow(
    "MANDATE_DAILY_LIMIT_TOTAL must be a positive integer",
  );
});

test("config refuses a missing database or an unknown watcher mode", () => {
  expect(() => readConfig({})).toThrow("Missing env DATABASE_URL");
  expect(() => readConfig({ ...base, WATCHER_MODE: "cron" })).toThrow("WATCHER_MODE");
});

test("the watcher config needs the workflow settings only in workflow mode", () => {
  expect(readWatcherConfig({})).toEqual({ watcherMode: "timer", workflow: null });
  expect(() => readWatcherConfig({ WATCHER_MODE: "workflow", RENDER_API_KEY: "k" })).toThrow(
    "Missing env WORKFLOW_SLUG",
  );
  expect(() => readWatcherConfig({ WATCHER_MODE: "workflow", WORKFLOW_SLUG: "s" })).toThrow(
    "Missing env RENDER_API_KEY",
  );
});
