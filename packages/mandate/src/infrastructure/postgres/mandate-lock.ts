import type { SQL } from "bun";
import type { MandateLock } from "../../application/ports.ts";

// Cross-process mandate lock: a Postgres advisory lock keyed by hashtext(mandateId), so the API,
// its timer and the Render Workflows worker serialise on the same mandate.
//
// The lock is transaction-scoped (pg_advisory_xact_lock) on a connection held by sql.begin for the
// whole of fn. Postgres drops it at commit or rollback, so a throw, a lock timeout or a lost
// connection all release it, and the connection goes back to the pool. A session lock with an
// explicit unlock would leak through a transaction-mode pooler such as Neon's "-pooler" host,
// where the unlock can land on a different server connection than the lock.
//
// Pass a pool of its own: fn runs its queries on the app pool, and a lock that shared that pool
// could hold every connection while fn waits for one.
export class PostgresMandateLock implements MandateLock {
  constructor(
    private readonly sql: SQL,
    private readonly waitMs = 30_000,
  ) {}

  run<T>(mandateId: string, fn: () => Promise<T>): Promise<T> {
    return this.sql.begin(async (tx) => {
      // Local to this transaction: a mandate held longer than waitMs fails this caller loudly.
      await tx`select set_config('lock_timeout', ${`${this.waitMs}ms`}, true)`;
      await tx`select pg_advisory_xact_lock(hashtext(${mandateId}))`;
      return fn();
    }) as Promise<T>;
  }
}
