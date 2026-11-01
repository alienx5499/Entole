import { createHash, randomBytes } from "node:crypto";

// Personal access tokens let an AI client act for a user on a few mandate routes.
// Only the hash is stored; the plaintext is shown once at creation.
export const API_TOKEN_PREFIX = "ent_";
const BODY = /^[A-Za-z0-9_-]{43}$/; // 32 bytes in base64url, no padding
export const MAX_TOKEN_NAME = 60;
export const MAX_LIVE_TOKENS = 20; // per user; a revoked token frees its place

export type ApiToken = {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export const generateApiToken = (): string =>
  `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;

export const isApiTokenShape = (s: string): boolean =>
  s.startsWith(API_TOKEN_PREFIX) && BODY.test(s.slice(API_TOKEN_PREFIX.length));

export const hashApiToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
