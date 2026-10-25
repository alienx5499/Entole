import { randomUUID } from "node:crypto";
import type { SQL } from "bun";
import type { UserRepository } from "../../application/ports.ts";
import type { User } from "../../domain/user.ts";

type Row = { id: string; paypal_user_id: string; email: string; name: string };
const toUser = (r: Row): User => ({
  id: r.id,
  paypalUserId: r.paypal_user_id,
  email: r.email,
  name: r.name,
});

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly sql: SQL) {}

  async upsertByPaypalId(u: Omit<User, "id">) {
    const [r] = await this.sql`
      insert into users (id, paypal_user_id, email, name)
      values (${`user_${randomUUID()}`}, ${u.paypalUserId}, ${u.email}, ${u.name})
      on conflict (paypal_user_id) do update set email = excluded.email, name = excluded.name
      returning id, paypal_user_id, email, name`;
    return toUser(r as Row);
  }

  async get(id: string) {
    const [r] = await this.sql`
      select id, paypal_user_id, email, name from users where id = ${id}`;
    return r ? toUser(r as Row) : null;
  }
}
