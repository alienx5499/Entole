import { randomBytes } from "node:crypto";
import type { ApiTokenGenerator } from "../../application/ports.ts";
import { API_TOKEN_PREFIX } from "../../domain/api-token.ts";

export class RandomApiTokenGenerator implements ApiTokenGenerator {
  next(): string {
    return `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  }
}
