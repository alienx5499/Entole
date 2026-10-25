import { createHash, randomBytes } from "node:crypto";
import type { SQL } from "bun";
import type { SessionRepository } from "../../application/ports.ts";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly sql: SQL) {}

  async create(userId: string, expiresAt: Date) {
    const token = randomBytes(32).toString("hex");
    await this.sql`
      insert into sessions (token, user_id, expires_at)
      values (${sha256(token)}, ${userId}, ${expiresAt})`;
    return token;
  }

  async userIdFor(token: string, now: Date) {
    const [r] = await this.sql`
      select user_id from sessions where token = ${sha256(token)} and expires_at > ${now}`;
    return r ? (r.user_id as string) : null;
  }

  async revoke(token: string) {
    await this.sql`delete from sessions where token = ${sha256(token)}`;
  }
}
