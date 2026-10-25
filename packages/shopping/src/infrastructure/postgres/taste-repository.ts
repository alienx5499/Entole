import type { SQL } from "bun";
import type { TasteRepository } from "../../application/ports.ts";
import type { Taste } from "../../domain/taste.ts";

export class PostgresTasteRepository implements TasteRepository {
  constructor(private readonly sql: SQL) {}

  async get(userId: string) {
    const [r] = await this.sql`select data from taste where user_id = ${userId}`;
    if (!r) return null;
    return (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as Taste;
  }

  async save(userId: string, t: Taste) {
    const data = JSON.stringify(t);
    await this.sql`
      insert into taste (user_id, data) values (${userId}, ${data}::text::jsonb)
      on conflict (user_id) do update set data = excluded.data`;
  }
}
