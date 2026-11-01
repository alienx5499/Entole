import { afterAll, beforeAll } from "bun:test";
import { migrate } from "@entole/mandate";
import { SQL } from "bun";
import { readEnv } from "./env.ts";

export const LIVE = process.env.LIVE === "1";

// Registers setup and teardown for a throwaway schema in DATABASE_URL, migrated twice to prove the
// migration is idempotent. Call it at the top of a live test file; the getter returns the connection.
export const useLivePostgres = (): (() => SQL) => {
  const schema = `entole_test_${Math.random().toString(36).slice(2, 10)}`;
  // One connection so the per-run search_path applies to every query. It goes to the direct
  // endpoint: a transaction-mode pooler (Neon's "-pooler" host) keeps a session SET on its shared
  // server connection, and the app would later inherit a search_path pointing at a dropped schema.
  let sql: SQL | undefined;
  beforeAll(async () => {
    if (!LIVE) return;
    sql = new SQL(readEnv("DATABASE_URL").replace("-pooler.", "."), { max: 1 });
    await sql.unsafe(`create schema ${schema}`);
    await sql.unsafe(`set search_path to ${schema}`);
    await migrate(sql);
    await migrate(sql);
  }, 60_000);
  afterAll(async () => {
    if (!LIVE || !sql) return;
    await sql.unsafe("reset search_path");
    await sql.unsafe(`drop schema if exists ${schema} cascade`);
    await sql.close();
  }, 60_000);
  return () => {
    if (!sql) throw new Error("Live Postgres is not connected");
    return sql;
  };
};
