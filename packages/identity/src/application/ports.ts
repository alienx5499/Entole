import type { ApiToken } from "../domain/api-token.ts";
import type { User } from "../domain/user.ts";

export interface UserRepository {
  upsertByPaypalId(u: Omit<User, "id">): Promise<User>;
  get(id: string): Promise<User | null>;
}

export interface SessionRepository {
  create(userId: string, expiresAt: Date): Promise<string>;
  userIdFor(token: string, now: Date): Promise<string | null>;
  revoke(token: string): Promise<void>;
}

export interface IdentityProvider {
  authorizeUrl(state: string): string;
  exchange(code: string): Promise<{ paypalUserId: string; email: string; name: string }>;
}

export interface ApiTokenRepository {
  create(t: {
    id: string;
    userId: string;
    name: string;
    hash: string;
    createdAt: Date;
  }): Promise<void>;
  listByUser(userId: string): Promise<ApiToken[]>;
  // Sets revoked_at; false when the token is not the user's or is already revoked.
  revoke(userId: string, id: string, now: Date): Promise<boolean>;
  // The owner of a live token with this hash, stamping last_used_at; null when unknown or revoked.
  use(hash: string, now: Date): Promise<string | null>;
}
