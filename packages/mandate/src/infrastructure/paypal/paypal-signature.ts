import { createVerify, X509Certificate } from "node:crypto";
import { crc32 } from "node:zlib";
import type { WebhookVerifier } from "../../application/ports.ts";

// The cert is fetched while PayPal waits; the order callback gives the whole answer 5 seconds.
const CERT_TIMEOUT_MS = 3_000;
const MAX_CACHED_CERTS = 32;

type Config = {
  // Webhooks sign `id|time|webhookId|crc32`. Order update callbacks have no webhook id and sign
  // `id|time|crc32`, so the callback verifier is built without one.
  webhookId?: string;
  fetch?: typeof fetch;
  now?: () => Date;
};

// Checks PayPal's SHA256withRSA signature locally against the cert named in `paypal-cert-url`.
// The cert URL comes from the request, so only https URLs on PayPal's API hosts are fetched, with
// no redirects: the TLS connection to PayPal is what makes the cert trustworthy, and the cert must
// also be issued to a paypal.com name. Certs are cached by URL.
export class PayPalSignatureVerifier implements WebhookVerifier {
  private readonly http: typeof fetch;
  private readonly now: () => Date;
  private readonly certs = new Map<string, Promise<X509Certificate>>();

  constructor(private readonly cfg: Config = {}) {
    this.http = cfg.fetch ?? fetch;
    this.now = cfg.now ?? (() => new Date());
  }

  // False for anything unsigned, forged or out of policy. A cert PayPal fails to serve throws, so
  // the caller answers non-2xx and PayPal retries instead of the delivery being dropped as forged.
  async verify(headers: Headers, body: string): Promise<boolean> {
    const id = headers.get("paypal-transmission-id");
    const time = headers.get("paypal-transmission-time");
    const sig = headers.get("paypal-transmission-sig");
    const certUrl = headers.get("paypal-cert-url");
    if (!id || !time || !sig || !certUrl) return false;
    if (headers.get("paypal-auth-algo") !== "SHA256withRSA") return false;
    if (!isPayPalCertUrl(certUrl)) return false;
    const cert = await this.cert(certUrl);
    const now = this.now().getTime();
    if (now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo)) return false;
    if (!PAYPAL_CERT_SUBJECT.test(cert.subject)) return false;
    const message = [id, time, this.cfg.webhookId, crc32(body)]
      .filter((p) => p !== undefined)
      .join("|");
    try {
      return createVerify("RSA-SHA256").update(message).verify(cert.publicKey, sig, "base64");
    } catch {
      return false;
    }
  }

  private cert(url: string): Promise<X509Certificate> {
    const cached = this.certs.get(url);
    if (cached) return cached;
    // Only paypal.com URLs get here, so the cache holds a handful of real certs.
    if (this.certs.size >= MAX_CACHED_CERTS) this.certs.clear();
    // No redirects: the cert must come from the exact PayPal host that was checked, over TLS.
    const next = this.http(url, {
      redirect: "error",
      signal: AbortSignal.timeout(CERT_TIMEOUT_MS),
    }).then(async (res) => {
      if (!res.ok) throw new Error(`PayPal cert fetch failed: status ${res.status}`);
      // The callback cert endpoint is documented as plain text but typed as a JSON string.
      const text = (await res.text()).trim();
      return new X509Certificate(text.startsWith('"') ? (JSON.parse(text) as string) : text);
    });
    this.certs.set(url, next);
    next.catch(() => {
      if (this.certs.get(url) === next) this.certs.delete(url);
    });
    return next;
  }
}

// PayPal's API hosts, live and sandbox. An exact list rather than any *.paypal.com host, so a
// cert can only come from the API that serves PayPal's signing certs.
const PAYPAL_CERT_HOSTS = new Set([
  "api.paypal.com",
  "api-m.paypal.com",
  "api.sandbox.paypal.com",
  "api-m.sandbox.paypal.com",
]);
// PayPal serves its signing certs only under this path; nothing else on the API hosts is fetched.
const PAYPAL_CERT_PATH = "/v1/notifications/certs/";
// The chain is not pinned to a PayPal root on purpose: pinning breaks verification whenever PayPal
// rotates intermediates. TLS to the exact host and path, no redirects and the subject check stand in.
// PayPal's signing certs are issued to a paypal.com name (messageverificationcerts.paypal.com and
// its sandbox twin for webhooks).
const PAYPAL_CERT_SUBJECT = /(^|\n)CN=[a-z0-9.-]*\.paypal\.com(\n|$)/i;

export const isPayPalCertUrl = (raw: string): boolean => {
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      PAYPAL_CERT_HOSTS.has(u.hostname.toLowerCase()) &&
      u.pathname.startsWith(PAYPAL_CERT_PATH)
    );
  } catch {
    return false;
  }
};
