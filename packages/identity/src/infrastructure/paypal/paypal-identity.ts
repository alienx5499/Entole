import type { IdentityProvider } from "../../application/ports.ts";

// A hung upstream call must not hold a mandate lock or a request forever.
const TIMEOUT_MS = 15_000;

export class PayPalIdentityError extends Error {
  constructor(readonly status: number) {
    super(`PayPal identity request failed: status ${status}`);
    this.name = "PayPalIdentityError";
  }
}

type Config = {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  publicBaseUrl: string;
  fetch?: typeof fetch;
};

type UserInfo = {
  user_id: string;
  name?: string;
  emails?: { value: string; primary?: boolean }[];
};

// Raw HTTP on purpose: the PayPal Server SDK has no userinfo endpoint and its token call is built
// for client credentials, not the authorization_code exchange Log in with PayPal needs.
export class PayPalIdentity implements IdentityProvider {
  private readonly http: typeof fetch;

  constructor(private readonly cfg: Config) {
    this.http = cfg.fetch ?? fetch;
  }

  private get redirectUri() {
    return `${this.cfg.publicBaseUrl}/api/auth/paypal/callback`;
  }

  authorizeUrl(state: string): string {
    const q = new URLSearchParams({
      flowEntry: "static",
      client_id: this.cfg.clientId,
      response_type: "code",
      scope: "openid email profile",
      redirect_uri: this.redirectUri,
      state,
    });
    return `https://www.sandbox.paypal.com/signin/authorize?${q.toString().replaceAll("+", "%20")}`;
  }

  async exchange(code: string) {
    const basic = btoa(`${this.cfg.clientId}:${this.cfg.clientSecret}`);
    const tokenRes = await this.http(`${this.cfg.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code }).toString(),
    });
    if (!tokenRes.ok) throw new PayPalIdentityError(tokenRes.status);
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    const infoRes = await this.http(
      `${this.cfg.baseUrl}/v1/identity/oauth2/userinfo?schema=paypalv1.1`,
      {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${access_token}` },
      },
    );
    if (!infoRes.ok) throw new PayPalIdentityError(infoRes.status);
    const info = (await infoRes.json()) as UserInfo;
    const email = (info.emails?.find((e) => e.primary) ?? info.emails?.[0])?.value ?? "";
    return { paypalUserId: info.user_id, email, name: info.name ?? "" };
  }
}
