import type { SQL } from "bun";

// One schema file for the whole app (mandates, audit, users, sessions, taste): a single idempotent
// step at boot. The identity and shopping repositories rely on it too.
export const migrate = async (sql: SQL): Promise<void> => {
  const ddl = await Bun.file(new URL("./schema.sql", import.meta.url)).text();
  await sql.unsafe(ddl);
};
