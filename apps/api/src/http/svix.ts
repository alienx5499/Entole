import { createHmac, timingSafeEqual } from "node:crypto";

export type SvixResult = "ok" | "missing_headers" | "stale" | "bad_signature";

// Svix refuses deliveries stamped more than five minutes from now, which stops replays.
const MAX_SKEW_SEC = 300;

const PREFIX = "whsec_";
// HMAC-SHA256 wants a real key; Svix issues 24 to 64 bytes, and base64 decoding never throws.
const MIN_KEY_BYTES = 24;

// Fails loudly so a missing or mangled secret can never become an empty, forgeable key.
export const parseSvixSecret = (secret: string): Buffer => {
  const key = Buffer.from(secret.slice(PREFIX.length), "base64");
  if (!secret.startsWith(PREFIX) || key.length < MIN_KEY_BYTES)
    throw new Error("CHANNEL3_WEBHOOK_SECRET is not a valid whsec_ secret");
  return key;
};

// Svix's scheme: HMAC-SHA256 over "id.timestamp.body", keyed with the base64 secret after "whsec_".
// The signature header lists one or more "v1,<base64>" values, so a rotated key still verifies.
// `key` is parseSvixSecret's result, decoded once at boot.
export const verifySvix = (key: Buffer, headers: Headers, raw: string, now: Date): SvixResult => {
  const id = headers.get("svix-id");
  const ts = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !ts || !signatures) return "missing_headers";
  if (!/^\d+$/.test(ts) || !(Math.abs(now.getTime() / 1000 - Number(ts)) <= MAX_SKEW_SEC))
    return "stale";
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest();
  const match = signatures.split(" ").some((s) => {
    if (!s.startsWith("v1,")) return false;
    const given = Buffer.from(s.slice(3), "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return match ? "ok" : "bad_signature";
};
