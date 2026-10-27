import { describe, expect, test } from "bun:test";
import { createSign } from "node:crypto";
import { crc32 } from "node:zlib";
import { PayPalSignatureVerifier } from "../../src/index.ts";

// Test-only key and self-signed cert (openssl req -x509 -newkey rsa:2048, valid 2026 to 2126).
// They sign nothing outside this file.
const KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCnsb1irwADB6fL
xbXnXgi3mLQHRUigGhOg+Tm9oly8IeGLJ0m5fU5P3auV77SOZ4/8WRHrzrAnqr2Y
sn++2fmLhpOI5/WvaSxk/k2ayW5PtGFANeyPez/CTdqTyTNE0Jxnux1OiJsgeDP1
7UQXtGMFdJFsgi/EeoOSJdPjtMPjNMB7RmggH/CRx7pYdZZg4EBKjSpiDPVFRoXK
gTIhMajC2s0sZBohc7wS31egtOrMt/aovAbovwIxkTe1G4Y3vN51acD9sP2NkmHm
ryCASVaeANnGlo8Z29NP7JlWRwMWTlSvHpIzW7MpxCSHHk5jt303Cs+4Dqsl+WVv
V9xrJdBfAgMBAAECggEAAVBSMuakRhF9RAp1F/SZ876UxU5II6FGAKSW92QgiQmk
3+Z3HG9vNeHerZMch3YsmGL7bYdoRwZWSyGzLZp5aHZJRDxZr78nt7SjQ4PmoTOJ
9Yu0GBfT7/LV9YV1b4C3WyotCDCSh/XdMjDgMnRxWNH3f0M+i1eR+orhDMVXZc2q
EAHY8qKYwNK/H8+7S09Du7NtAlnv5Fh3pML55ZoYyYPy7Nw5FiiPX58N+XM7pToW
r3hMlzqSfRyrnoF6lVMibeYwA6taRRC1JWUqJ7gUiRAlr3pARYAIiVALA6+I/oEs
uboCj1iMIzyib2FbYSB170oDwajo9daIWEBUpQAYyQKBgQDQfeOclX0R4uqTUJMh
Oizf5Csxf/zvIC+V5pP+RDf7KATLmiT7/WSfIDdAtLe0HHH3dxyHrrx6zfII4392
Mxx4w0C8R66LgG+QQrGTJOuv1vyWQW/Gz4IQFmn56f6nnxT/AZ7bVXDm76QBUona
JgfEKjcivmtnk3kMuKqjgH5tawKBgQDN5/sgg4BmRUCbR5yhIpHy11SgBHbAnpcB
ikxzP/dm1vTqQuJu0BaPwv9Sgz8yc2tvnrBFzzUWa/NJvmELt283b5ZBmjyviIIf
jsHWC486kS3F//UiiPvhHXmzKQn8YNviAt9zUaXWRwRjkSuNwtXXJl52Adwl1xex
3dPaSkfR3QKBgH584aoNx2Mil83oBFsUQEVU2B+f1oP8suHukbqhCJWHIeGkEuwO
Pw2LLfpDqW/MEhhgWx62FAMtDrn1y06ak5twWcXgdzSLJyQOUk1DCPoVJAjEilvD
aNT5xDGqlKR9Du/mu8m1fFme6ZEj0h5XFD8enXSmseKUxcvB/URUoF8hAoGBAJHN
jhcU5ywEJ96M1A2KFD0YW3VAE/MLmbRegQovJnotBpqHqB19viwokXGVPH/2GQKe
JQYZ1ua8pDb413FbgCaKHqTvmb9Wc4XzKbDu2IpJWVdWivfcdjePDqleCxMqZylg
jWf0TfEwspvqpSOp7pB+O+9mG8SzzbSGdsihRsAFAoGAaa3o1iMwbGpXEuOanDJI
m45z0HAu5EvbL6R4+k47wl/2YrMixCnVAlnOEljBYf3xM+JW1OwkPxX13BeBj+CN
hosxpXxfPGq7zTNRj4O+ulq2Hjct48vZnOeJsjgj/2oEtrMTOiKh+HT7TK0EylDG
YLEeTliWUG9IYme3XsuKl1o=
-----END PRIVATE KEY-----`;
const CERT = `-----BEGIN CERTIFICATE-----
MIIDLjCCAhagAwIBAgIUJmUPxCgRNtQNTV05M/w86gUfJj8wDQYJKoZIhvcNAQEL
BQAwNjE0MDIGA1UEAwwrbWVzc2FnZXZlcmlmaWNhdGlvbmNlcnRzLnNhbmRib3gu
cGF5cGFsLmNvbTAgFw0yNjEwMjcwNDE1MjBaGA8yMTI2MTAwMzA0MTUyMFowNjE0
MDIGA1UEAwwrbWVzc2FnZXZlcmlmaWNhdGlvbmNlcnRzLnNhbmRib3gucGF5cGFs
LmNvbTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAKexvWKvAAMHp8vF
tedeCLeYtAdFSKAaE6D5Ob2iXLwh4YsnSbl9Tk/dq5XvtI5nj/xZEevOsCeqvZiy
f77Z+YuGk4jn9a9pLGT+TZrJbk+0YUA17I97P8JN2pPJM0TQnGe7HU6ImyB4M/Xt
RBe0YwV0kWyCL8R6g5Il0+O0w+M0wHtGaCAf8JHHulh1lmDgQEqNKmIM9UVGhcqB
MiExqMLazSxkGiFzvBLfV6C06sy39qi8Bui/AjGRN7Ubhje83nVpwP2w/Y2SYeav
IIBJVp4A2caWjxnb00/smVZHAxZOVK8ekjNbsynEJIceTmO3fTcKz7gOqyX5ZW9X
3Gsl0F8CAwEAAaMyMDAwHQYDVR0OBBYEFHGahJXywFAI2NSgxWjRkcIKtrG6MA8G
A1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBABM0iY6juuoe13XYmYI/
VLzYfXwxlYJ0hdVmMgaejMY3DMhwx2Gs5JoWCrzX+vCNwqCPQ4p3dOsm2ODJ8edE
I6FO+mm+i3dzuA+jn8lnzWsmwQAawY577wgNCfpVtB52699pa9ek+s3AwZXtoK7F
CngeiZD43DXNmO8KTFV5jGvYBP/a64usOKqoiGXuEsapJKcWZWbY/x9zwFIYKyMW
xc6+MJC2umy8+qxOH8zCmjJ4N69Wwd1Hl8KC0YBZpz/+gFue2ej8Wd5fYA67pXfs
DZD7SmspBJXTtOo20SUCGeDJv31oPgRYtdx6nK0ZrEHhAbu94jcr99JguAj1lDfa
biw=
-----END CERTIFICATE-----`;

const CERT_URL = "https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-test";
const NOW = new Date("2027-01-01T00:00:00Z");
const BODY = '{"id":"WH-1","event_type":"CHECKOUT.ORDER.APPROVED"}';

const sign = (message: string) => createSign("RSA-SHA256").update(message).sign(KEY, "base64");

const headersFor = (sig: string, over: Record<string, string> = {}) =>
  new Headers({
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": CERT_URL,
    "paypal-transmission-id": "T1",
    "paypal-transmission-time": "2026-12-31T23:59:00Z",
    "paypal-transmission-sig": sig,
    ...over,
  });

const webhookSig = (body = BODY, webhookId = "WH-ID") =>
  sign(`T1|2026-12-31T23:59:00Z|${webhookId}|${crc32(body)}`);

const setup = (opts: { webhookId?: string; now?: Date; status?: number } = {}) => {
  const fetched: string[] = [];
  const stub = (async (url: string) => {
    fetched.push(url);
    return new Response(CERT, { status: opts.status ?? 200 });
  }) as unknown as typeof fetch;
  const verifier = new PayPalSignatureVerifier({
    ...(opts.webhookId ? { webhookId: opts.webhookId } : {}),
    fetch: stub,
    now: () => opts.now ?? NOW,
  });
  return { verifier, fetched };
};

// Same test key, issued to a name outside paypal.com.
const FOREIGN_CERT = `-----BEGIN CERTIFICATE-----
MIIC8DCCAdigAwIBAgIUIKHZbicStFh58heo7iND13gwlQIwDQYJKoZIhvcNAQEL
BQAwFzEVMBMGA1UEAwwMZXZpbC5leGFtcGxlMCAXDTI2MTAyNzA0MjM1MFoYDzIx
MjYxMDAzMDQyMzUwWjAXMRUwEwYDVQQDDAxldmlsLmV4YW1wbGUwggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQCnsb1irwADB6fLxbXnXgi3mLQHRUigGhOg
+Tm9oly8IeGLJ0m5fU5P3auV77SOZ4/8WRHrzrAnqr2Ysn++2fmLhpOI5/WvaSxk
/k2ayW5PtGFANeyPez/CTdqTyTNE0Jxnux1OiJsgeDP17UQXtGMFdJFsgi/EeoOS
JdPjtMPjNMB7RmggH/CRx7pYdZZg4EBKjSpiDPVFRoXKgTIhMajC2s0sZBohc7wS
31egtOrMt/aovAbovwIxkTe1G4Y3vN51acD9sP2NkmHmryCASVaeANnGlo8Z29NP
7JlWRwMWTlSvHpIzW7MpxCSHHk5jt303Cs+4Dqsl+WVvV9xrJdBfAgMBAAGjMjAw
MB0GA1UdDgQWBBRxmoSV8sBQCNjUoMVo0ZHCCraxujAPBgNVHRMBAf8EBTADAQH/
MA0GCSqGSIb3DQEBCwUAA4IBAQAu46zCgM+pFY43xJLZUz6c8OtEmoSRaxMgX3dp
XwS36USqFkJhQaFshAyJSVzUYNuASE8L5zWEMqNGUp/dsE8LRS4Ayjrl8CsikObv
AoBhSBRSjjMz5leKkykDQlU25ZvlyMyWJ1058+ymP2FKYe1tTExwVHquSXTq++NL
SlcqaiXmFUOW9GpQRHkYHSdfCvjZ42ay7nHw7SRSHtAO+eSj7YNc2uXNy5Osg4gw
z94Rl6LUvjhdBUAgoLLjd673Xtli2kC76xTIehEnFbC3lMoFMNWSJbuopgjBcUYV
OhDFge3NvYJqKu03pq8Brcon5hKmMqhHYTOBkYcesprF3OdH
-----END CERTIFICATE-----`;

describe("PayPalSignatureVerifier", () => {
  test("fetches the cert without following redirects", async () => {
    let init: RequestInit | undefined;
    const stub = (async (_url: string, i?: RequestInit) => {
      init = i;
      return new Response(CERT);
    }) as unknown as typeof fetch;
    const verifier = new PayPalSignatureVerifier({
      webhookId: "WH-ID",
      fetch: stub,
      now: () => NOW,
    });
    expect(await verifier.verify(headersFor(webhookSig()), BODY)).toBe(true);
    expect(init?.redirect).toBe("error");
  });

  test("refuses a correctly signed message whose cert is not issued to a paypal.com name", async () => {
    const stub = (async () => new Response(FOREIGN_CERT)) as unknown as typeof fetch;
    const verifier = new PayPalSignatureVerifier({
      webhookId: "WH-ID",
      fetch: stub,
      now: () => NOW,
    });
    expect(await verifier.verify(headersFor(webhookSig()), BODY)).toBe(false);
  });

  test("accepts a webhook signed over id|time|webhookId|crc32 and caches the cert", async () => {
    const { verifier, fetched } = setup({ webhookId: "WH-ID" });
    expect(await verifier.verify(headersFor(webhookSig()), BODY)).toBe(true);
    expect(await verifier.verify(headersFor(webhookSig()), BODY)).toBe(true);
    expect(fetched).toEqual([CERT_URL]);
  });

  test("the crc32 is the unsigned decimal of the raw UTF-8 body", async () => {
    // A body whose CRC32 has the top bit set, so a signed reading would print a negative number.
    const body = '{"id":"WH-8","note":"caf\u00e9 \u2713"}';
    expect(crc32(body)).toBeGreaterThan(2 ** 31);
    const { verifier } = setup({ webhookId: "WH-ID" });
    expect(await verifier.verify(headersFor(webhookSig(body)), body)).toBe(true);
  });

  test("reads a cert served as a JSON string, as the callback cert endpoint is typed", async () => {
    const stub = (async () => new Response(JSON.stringify(CERT))) as unknown as typeof fetch;
    const verifier = new PayPalSignatureVerifier({
      webhookId: "WH-ID",
      fetch: stub,
      now: () => NOW,
    });
    expect(await verifier.verify(headersFor(webhookSig()), BODY)).toBe(true);
  });

  test("rejects a tampered body and a different webhook id", async () => {
    const { verifier } = setup({ webhookId: "WH-ID" });
    expect(await verifier.verify(headersFor(webhookSig()), BODY.replace("WH-1", "WH-9"))).toBe(
      false,
    );
    expect(await verifier.verify(headersFor(webhookSig(BODY, "OTHER")), BODY)).toBe(false);
  });

  test("order callbacks sign id|time|crc32, with no webhook id", async () => {
    const { verifier } = setup();
    const callbackSig = sign(`T1|2026-12-31T23:59:00Z|${crc32(BODY)}`);
    expect(await verifier.verify(headersFor(callbackSig), BODY)).toBe(true);
    expect(await verifier.verify(headersFor(webhookSig()), BODY)).toBe(false);
  });

  test("refuses cert URLs off paypal.com or over http without fetching them", async () => {
    const { verifier, fetched } = setup({ webhookId: "WH-ID" });
    for (const url of [
      "https://evil.example/cert.pem",
      "https://api.paypal.com.evil.example/cert.pem",
      "https://paypal.com@evil.example/cert.pem",
      "https://www.paypal.com/cert.pem",
      "https://api.sandbox.paypal.com:8443/cert.pem",
      "https://api-m.sandbox.paypal.com/v1/oauth2/token",
      "http://api.sandbox.paypal.com/cert.pem",
      "not a url",
    ])
      expect(
        await verifier.verify(headersFor(webhookSig(), { "paypal-cert-url": url }), BODY),
      ).toBe(false);
    expect(fetched).toEqual([]);
  });

  test("refuses another algorithm, missing headers and a garbage signature", async () => {
    const { verifier } = setup({ webhookId: "WH-ID" });
    const algo = headersFor(webhookSig(), { "paypal-auth-algo": "SHA1withRSA" });
    expect(await verifier.verify(algo, BODY)).toBe(false);
    expect(await verifier.verify(new Headers(), BODY)).toBe(false);
    expect(await verifier.verify(headersFor("not-base64!!"), BODY)).toBe(false);
  });

  test("refuses a cert outside its validity dates", async () => {
    const late = setup({ webhookId: "WH-ID", now: new Date("2127-01-01T00:00:00Z") });
    expect(await late.verifier.verify(headersFor(webhookSig()), BODY)).toBe(false);
    const early = setup({ webhookId: "WH-ID", now: new Date("2020-01-01T00:00:00Z") });
    expect(await early.verifier.verify(headersFor(webhookSig()), BODY)).toBe(false);
  });

  test("a cert PayPal fails to serve throws, and is fetched again next time", async () => {
    const { verifier, fetched } = setup({ webhookId: "WH-ID", status: 503 });
    await expect(verifier.verify(headersFor(webhookSig()), BODY)).rejects.toThrow("status 503");
    await expect(verifier.verify(headersFor(webhookSig()), BODY)).rejects.toThrow("status 503");
    expect(fetched).toHaveLength(2);
  });
});
