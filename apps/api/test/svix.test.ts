import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { parseSvixSecret, verifySvix } from "../src/http/svix.ts";

const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const SECRET = `whsec_${KEY.toString("base64")}`;
const ID = "msg_1";
const TS = 1793500000;
const BODY = '{"a":1}';
const AT = new Date(TS * 1000);

const sign = (body = BODY) =>
  `v1,${createHmac("sha256", KEY).update(`${ID}.${TS}.${body}`).digest("base64")}`;

const headers = (signature = sign(), extra: Record<string, string> = {}) =>
  new Headers({
    "svix-id": ID,
    "svix-timestamp": String(TS),
    "svix-signature": signature,
    ...extra,
  });

test("accepts a valid signature", () => {
  expect(verifySvix(KEY, headers(), BODY, AT)).toBe("ok");
});

test("rejects a timestamp more than 300 s off either way", () => {
  expect(verifySvix(KEY, headers(), BODY, new Date((TS + 301) * 1000))).toBe("stale");
  expect(verifySvix(KEY, headers(), BODY, new Date((TS - 301) * 1000))).toBe("stale");
  expect(verifySvix(KEY, headers(), BODY, new Date((TS + 300) * 1000))).toBe("ok");
});

test("rejects a flipped byte", () => {
  expect(verifySvix(KEY, headers(), '{"a":2}', AT)).toBe("bad_signature");
  const sig = Buffer.from(sign().slice(3), "base64");
  sig[0] = (sig[0] ?? 0) ^ 1;
  expect(verifySvix(KEY, headers(`v1,${sig.toString("base64")}`), BODY, AT)).toBe("bad_signature");
});

test("accepts when the second listed signature matches (key rotation)", () => {
  expect(verifySvix(KEY, headers(`v1,AAAA ${sign()}`), BODY, AT)).toBe("ok");
});

test("rejects a garbage or non-v1 signature", () => {
  expect(verifySvix(KEY, headers("v1,"), BODY, AT)).toBe("bad_signature");
  expect(verifySvix(KEY, headers(sign().replace("v1,", "v2,")), BODY, AT)).toBe("bad_signature");
});

test("reports missing headers", () => {
  for (const name of ["svix-id", "svix-timestamp", "svix-signature"]) {
    const h = headers();
    h.delete(name);
    expect(verifySvix(KEY, h, BODY, AT)).toBe("missing_headers");
  }
});

test("refuses malformed secrets", () => {
  const short = `whsec_${Buffer.alloc(16, 7).toString("base64")}`;
  for (const bad of ["whsec_", "whsec_!!!!", "garbage", short, KEY.toString("base64")]) {
    expect(() => parseSvixSecret(bad)).toThrow(
      "CHANNEL3_WEBHOOK_SECRET is not a valid whsec_ secret",
    );
  }
  expect(parseSvixSecret(SECRET)).toEqual(KEY);
});

test("a signature made with an empty key never verifies", () => {
  const forged = `v1,${createHmac("sha256", Buffer.alloc(0)).update(`${ID}.${TS}.${BODY}`).digest("base64")}`;
  expect(verifySvix(KEY, headers(forged), BODY, AT)).toBe("bad_signature");
});

test("treats a non-numeric timestamp as stale", () => {
  for (const ts of ["soon", "1793500000.0", "+1793500000", "1e9"])
    expect(verifySvix(KEY, headers(sign(), { "svix-timestamp": ts }), BODY, AT)).toBe("stale");
});
