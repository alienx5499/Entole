// Copied from docs/API_CONTRACT.md. Money is a decimal USD string, dates are ISO strings.

export type Taste = { brands: string[]; avoid: string[]; attributes: Record<string, string> };

export type MeView = {
  user: { id: string; email: string; name: string };
  taste: Taste | null;
};

export type CandidateView = {
  productId: string;
  merchant: string;
  shops: string[];
  title: string;
  options: Record<string, string>;
  baselinePrice: string;
};

export type RejectedView = { title: string; merchant: string; details: string[] };

export type VerdictView =
  | { kind: "allow" }
  | { kind: "block"; reasons: string[]; details: string[] };

export type AuditView = {
  at: string;
  kind:
    | "created"
    | "funded"
    | "agent_step"
    | "proposal_allowed"
    | "proposal_blocked"
    | "capture_failed"
    | "paypal_event"
    | "refunded"
    | "hold_renewed"
    | "ship_to_refused"
    | "channel3_noted"
    | "closed";
  message: string;
  data?: Record<string, string>;
};

export type MandateOutcome =
  | "needs_approval"
  | "expired"
  | "watching"
  | "bought"
  | "refunded"
  | "released"
  | "cancelled";

export type MandateSummary = {
  id: string;
  status: MandateView["status"];
  outcome: MandateOutcome;
  query: string;
  limitPrice: string;
  captured: string;
  createdAt: string;
  validUntil: string;
};

// PayPal-side facts for the owner's receipt; null until that step has happened.
export type ReceiptView = {
  paypalOrderId: string | null;
  authorizationId: string | null;
  captureId: string | null;
  refundId: string | null;
  // The custom_id sent with the PayPal order; it equals the mandate digest.
  customId: string;
  // The hold renewed after PayPal's 3-day honor period; null until that happens.
  holdRenewed: { at: string; authorizationId: string; previousAuthorizationId: string } | null;
  amounts: { held: string; captured: string; released: string; refunded: string };
  times: {
    approved: string | null;
    captured: string | null;
    released: string | null;
    refunded: string | null;
  };
  confirmations: { at: string; eventType: string; message: string; eventId: string }[];
};

export type MandateView = {
  id: string;
  status: "awaiting_approval" | "funded" | "exhausted" | "closed";
  outcome: MandateOutcome;
  kind: "standard" | "limit";
  digest: string;
  createdAt: string;
  validUntil: string;
  /** The latest time a check may be proposed or dragged to: window end or hold expiry, if sooner. */
  latestCheckAt: string;
  terms: {
    query: string;
    brands: string[];
    avoid: string[];
    requiredAttributes: Record<string, string>;
    limitPrice: string;
    budget: string;
    allowedMerchants: string[];
  };
  candidates: CandidateView[];
  rejected: RejectedView[];
  approveUrl: string | null;
  held: string;
  captured: string;
  remaining: string;
  voided: boolean;
  authorizationId: string | null;
  demoInjection: boolean;
  replay: boolean;
  purchase: null | {
    productId: string;
    title: string;
    merchant: string;
    shopsCompared: number;
    price: string;
    captureId: string;
    paypal: {
      status: string | null;
      sellerProtection: string | null;
      fee: string | null;
      net: string | null;
    };
    shipTo: null | {
      name: string;
      lines: string[];
      city: string;
      region: string;
      postalCode: string;
      country: string;
    };
    savings: string;
    inReplay: boolean;
    whyThisOne: { chosen: string; skipped: { title: string; reasons: string[] }[] };
  };
  receipt: ReceiptView;
  audit: AuditView[];
  sandbox: true;
};

export type CreateMandateRequest = {
  query: string;
  brands: string[];
  avoid: string[];
  requiredAttributes: Record<string, string>;
  limitPrice: string;
  validDays: number;
  demoInjection: boolean;
  replay: boolean;
};

export type CreateMandateResponse = {
  id: string;
  approveUrl: string;
  candidates: CandidateView[];
  rejected: RejectedView[];
};

export type CheckNowResponse = { checked: number; captured: string[]; mandate: MandateView };

export type ReplayStartResponse = { startedAt: string; msPerPoint: number; points: number };

export type PricePoint = { at: string; price: string };

export type PriceSeries = {
  productId: string;
  title: string;
  limit: string;
  points: PricePoint[];
  currentIndex: number | null;
  current: string | null;
  /** Over the whole recorded history (30 days); null when Channel3 has none. */
  stats: PriceStatsView | null;
};

export type PriceStatsView = {
  low: string;
  high: string;
  current: string;
  aboveLowPercent: number | null;
};

export type PricesResponse = {
  replay: boolean;
  startedAt: string | null;
  msPerPoint: number;
  candidates: PriceSeries[];
};

export type SimulateResponse = { verdict: VerdictView };

export type ApiTokenView = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type CreatedApiToken = { id: string; token: string };
