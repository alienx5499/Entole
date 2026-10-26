import type {
  ApiToken,
  ApiTokenRepository,
  IdentityProvider,
  SessionRepository,
  User,
  UserRepository,
} from "@entole/identity";

export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, User>();
  async upsertByPaypalId(u: Omit<User, "id">) {
    const found = [...this.users.values()].find((x) => x.paypalUserId === u.paypalUserId);
    const user = { ...u, id: found?.id ?? `user-${this.users.size + 1}` };
    this.users.set(user.id, user);
    return user;
  }
  async get(id: string) {
    return this.users.get(id) ?? null;
  }
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, { userId: string; expiresAt: Date }>();
  async create(userId: string, expiresAt: Date) {
    const token = crypto.randomUUID();
    this.sessions.set(token, { userId, expiresAt });
    return token;
  }
  async userIdFor(token: string, now: Date) {
    const s = this.sessions.get(token);
    return s && s.expiresAt > now ? s.userId : null;
  }
  async revoke(token: string) {
    this.sessions.delete(token);
  }
}

export class FakeIdentityProvider implements IdentityProvider {
  authorizeUrl(state: string) {
    return `https://paypal.test/login?state=${state}`;
  }
  async exchange(code: string) {
    return { paypalUserId: `pp-${code}`, email: `${code}@example.com`, name: "Test Buyer" };
  }
}

export class InMemoryApiTokenRepository implements ApiTokenRepository {
  readonly rows = new Map<string, ApiToken & { userId: string; hash: string }>();
  async create(t: { id: string; userId: string; name: string; hash: string; createdAt: Date }) {
    this.rows.set(t.id, { ...t, lastUsedAt: null, revokedAt: null });
  }
  async listByUser(userId: string) {
    return [...this.rows.values()]
      .filter((r) => r.userId === userId)
      .map(({ id, name, createdAt, lastUsedAt, revokedAt }) => ({
        id,
        name,
        createdAt,
        lastUsedAt,
        revokedAt,
      }));
  }
  async revoke(userId: string, id: string, now: Date) {
    const r = this.rows.get(id);
    if (!r || r.userId !== userId || r.revokedAt) return false;
    r.revokedAt = now;
    return true;
  }
  async use(hash: string, now: Date) {
    const r = [...this.rows.values()].find((x) => x.hash === hash && !x.revokedAt);
    if (!r) return null;
    r.lastUsedAt = now;
    return r.userId;
  }
}
