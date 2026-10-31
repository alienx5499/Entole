import type { SQL } from "bun";
import type {
  IdempotencyClaim,
  IdempotencyRecord,
  IdempotencyStore,
} from "../../application/ports.ts";

type Row = { route: string; body_hash: string; status: number | null; body: string | null };
const toRecord = (row: Row): IdempotencyRecord => ({
  route: row.route,
  bodyHash: row.body_hash,
  response: row.status === null ? null : { status: Number(row.status), body: row.body ?? "" },
});

export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly sql: SQL) {}

  async claim(
    r: { callerId: string; key: string; route: string; bodyHash: string; expiresAt: Date },
    now: Date,
  ): Promise<IdempotencyClaim> {
    await this.sql`delete from idempotency_keys where expires_at <= ${now}`;
    // A second pass covers a claim released between the insert and the read.
    for (let attempt = 0; attempt < 2; attempt++) {
      const [mine] = await this.sql`
        insert into idempotency_keys (caller_id, key, route, body_hash, expires_at, claim_id)
        values (${r.callerId}, ${r.key}, ${r.route}, ${r.bodyHash}, ${r.expiresAt},
          ${crypto.randomUUID()})
        on conflict (caller_id, key) do nothing
        returning claim_id`;
      if (mine) return { claimId: mine.claim_id };
      const [row] = await this.sql`
        select route, body_hash, status, body from idempotency_keys
        where caller_id = ${r.callerId} and key = ${r.key}`;
      if (row) return { held: toRecord(row) };
    }
    // Released twice in a row: some request keeps taking and failing it, so call it busy.
    return { held: { route: r.route, bodyHash: r.bodyHash, response: null } };
  }

  async complete(
    callerId: string,
    key: string,
    claimId: string,
    response: { status: number; body: string },
    expiresAt: Date,
  ) {
    await this.sql`
      update idempotency_keys
      set status = ${response.status}, body = ${response.body}, expires_at = ${expiresAt}
      where caller_id = ${callerId} and key = ${key} and claim_id = ${claimId}`;
  }

  async release(callerId: string, key: string, claimId: string) {
    await this.sql`
      delete from idempotency_keys
      where caller_id = ${callerId} and key = ${key} and claim_id = ${claimId} and status is null`;
  }
}
