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

// Makes the plaintext of a new API token: API_TOKEN_PREFIX plus 32 random bytes in base64url.
export interface ApiTokenGenerator {
  next(): string;
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
  // The owner of a live token with this hash, stamping last_used_at (at most once a minute); null
  // when unknown or revoked.
  use(hash: string, now: Date): Promise<string | null>;
}

// What a caller's earlier request under the same Idempotency-Key was, and its answer once done.
export type IdempotencyRecord = {
  route: string;
  bodyHash: string;
  response: { status: number; body: string } | null; // null while the first request runs
};

// Either this request now holds the key (claimId names its hold) or an earlier one does.
export type IdempotencyClaim = { claimId: string } | { held: IdempotencyRecord };

// Keys are scoped per caller, so one user can never read another's stored answer.
export interface IdempotencyStore {
  // Atomically takes (callerId, key) until expiresAt (a short lease) and returns its claimId, or
  // returns the live record already holding it. Expired records and leases are dropped first.
  claim(
    r: { callerId: string; key: string; route: string; bodyHash: string; expiresAt: Date },
    now: Date,
  ): Promise<IdempotencyClaim>;
  // complete and release touch the row only while claimId still holds it: a request that outlived
  // its lease must not overwrite or free the claim of the request that took the key over.
  complete(
    callerId: string,
    key: string,
    claimId: string,
    response: { status: number; body: string },
    expiresAt: Date, // how long the stored answer is replayed
  ): Promise<void>;
  // Frees a claim whose request failed, so a retry can run it again.
  release(callerId: string, key: string, claimId: string): Promise<void>;
}
