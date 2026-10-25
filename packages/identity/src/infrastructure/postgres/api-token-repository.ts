import type { SQL } from "bun";
import type { ApiTokenRepository } from "../../application/ports.ts";
import type { ApiToken } from "../../domain/api-token.ts";

type Row = {
  id: string;
  name: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
};
const toToken = (r: Row): ApiToken => ({
  id: r.id,
  name: r.name,
  createdAt: new Date(r.created_at),
  lastUsedAt: r.last_used_at ? new Date(r.last_used_at) : null,
  revokedAt: r.revoked_at ? new Date(r.revoked_at) : null,
});

export class PostgresApiTokenRepository implements ApiTokenRepository {
  constructor(private readonly sql: SQL) {}

  async create(t: { id: string; userId: string; name: string; hash: string; createdAt: Date }) {
    await this.sql`
      insert into api_tokens (id, user_id, name, hash, created_at)
      values (${t.id}, ${t.userId}, ${t.name}, ${t.hash}, ${t.createdAt})`;
  }

  async listByUser(userId: string) {
    const rows = await this.sql`
      select id, name, created_at, last_used_at, revoked_at from api_tokens
      where user_id = ${userId} order by created_at desc`;
    return (rows as Row[]).map(toToken);
  }

  async revoke(userId: string, id: string, now: Date) {
    const rows = await this.sql`
      update api_tokens set revoked_at = ${now}
      where id = ${id} and user_id = ${userId} and revoked_at is null
      returning id`;
    return rows.length > 0;
  }

  async use(hash: string, now: Date) {
    const [r] = await this.sql`
      update api_tokens set last_used_at = ${now}
      where hash = ${hash} and revoked_at is null
      returning user_id`;
    return r ? (r.user_id as string) : null;
  }
}
