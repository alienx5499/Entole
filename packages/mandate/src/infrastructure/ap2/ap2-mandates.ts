import { createHash } from "node:crypto";
import type { AuditEntry } from "../../domain/audit.ts";
import { type Candidate, type Mandate, shopsOf } from "../../domain/mandate.ts";

// One Entole limit order as Agent Payments Protocol (AP2) v0.2 mandates, the release of
// 2026-04-28 (ap2-protocol.org). Field names follow the spec's JSON schemas exactly. A limit order
// is AP2's Human Not Present mode: the buyer approves open mandates (constraints), then the agent
// closes them on one checkout. Pure: everything comes from the mandate and its audit log.

type Merchant = { id: string; name: string; website?: string };
type Amount = { amount: number; currency: string };
type AcceptableItem = { id: string; title: string };
type PaymentInstrument = { id: string; type: string; description?: string };

export type Ap2OpenCheckoutMandate = {
  vct: "mandate.checkout.open.1";
  constraints: (
    | { type: "checkout.allowed_merchants"; allowed: Merchant[] }
    | {
        type: "checkout.line_items";
        items: { id: string; acceptable_items: AcceptableItem[]; quantity: number }[];
      }
  )[];
  cnf: Record<string, never>;
  iat: number;
  exp: number;
};

export type Ap2OpenPaymentMandate = {
  vct: "mandate.payment.open.1";
  constraints: (
    | { type: "payment.amount_range"; currency: string; max: number }
    | { type: "payment.allowed_payees"; allowed: Merchant[] }
    | { type: "payment.allowed_payment_instruments"; allowed: PaymentInstrument[] }
    | { type: "payment.execution_date"; not_after: string }
    | { type: "payment.reference"; conditional_transaction_id: string }
  )[];
  cnf: Record<string, never>;
  iat: number;
  exp: number;
};

export type Ap2CheckoutMandate = {
  vct: "mandate.checkout.1";
  checkout_jwt: string;
  checkout_hash: string;
  iat: number;
};

export type Ap2PaymentMandate = {
  vct: "mandate.payment.1";
  transaction_id: string;
  payee: Merchant;
  payment_amount: Amount;
  payment_instrument: PaymentInstrument;
  execution_date: string;
  iat: number;
};

export type Ap2Export = {
  protocol: "AP2";
  version: "0.2";
  spec: "https://ap2-protocol.org/";
  mode: "human_not_present";
  signed: false;
  note: string;
  entole: {
    mandateId: string;
    status: Mandate["status"];
    digest: string;
    digestAlgorithm: "sha-256";
    paypal: {
      orderId: string | null;
      customId: string;
      authorizationId: string | null;
      captureId: string | null;
      refundId: string | null;
    };
  };
  openCheckoutMandate: Ap2OpenCheckoutMandate;
  openPaymentMandate: Ap2OpenPaymentMandate;
  // Present once the one capture happened; null while the order is open or was never filled.
  checkoutMandate: Ap2CheckoutMandate | null;
  paymentMandate: Ap2PaymentMandate | null;
};

export const AP2_NOTE =
  "Unsigned claim sets. AP2 secures each mandate as an SD-JWT: open mandates signed for the " +
  "buyer with the agent's public key in cnf, closed mandates signed by that agent key, and " +
  "checkout_jwt signed by the merchant. Entole holds no buyer or agent signing key and the shops " +
  "do not sign checkouts, so cnf is empty, checkout_jwt is an unsecured JWT (alg none) and every " +
  "hash is base64url SHA-256 over the JSON bytes shown here. What binds the buyer is the PayPal " +
  "approval: entole.digest is the SHA-256 of the signed terms and is the PayPal order custom_id.";

// The account that receives the captured funds in this sandbox demo; the shops are not paid.
const PAYEE: Merchant = { id: "entole", name: "Entole" };

const epoch = (d: Date) => Math.floor(d.getTime() / 1000);
const sha256 = (s: string) => createHash("sha256").update(s).digest("base64url");
const b64url = (s: string) => Buffer.from(s).toString("base64url");

const merchantOf = (shop: string): Merchant => ({
  id: shop,
  name: shop,
  ...(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(shop) ? { website: `https://${shop}` } : {}),
});

// AP2 items carry only id and title, so the signed options ride in the title.
const titleOf = (c: Candidate) => {
  const options = Object.entries(c.options).map(([k, v]) => `${k} ${v}`);
  return options.length > 0 ? `${c.title} (${options.join(", ")})` : c.title;
};

const openMandates = (m: Mandate) => {
  const iat = epoch(m.createdAt);
  const exp = epoch(m.terms.validUntil);
  const shops = [...new Set(m.terms.candidates.flatMap(shopsOf))];
  const checkout: Ap2OpenCheckoutMandate = {
    vct: "mandate.checkout.open.1",
    constraints: [
      { type: "checkout.allowed_merchants", allowed: shops.map(merchantOf) },
      {
        type: "checkout.line_items",
        items: [
          {
            id: "item_1",
            acceptable_items: m.terms.candidates.map((c) => ({
              id: c.productId,
              title: titleOf(c),
            })),
            quantity: 1,
          },
        ],
      },
    ],
    cnf: {},
    iat,
    exp,
  };
  const payment: Ap2OpenPaymentMandate = {
    vct: "mandate.payment.open.1",
    constraints: [
      { type: "payment.amount_range", currency: "USD", max: m.terms.maxUnitPrice.cents },
      { type: "payment.allowed_payees", allowed: [PAYEE] },
      ...(m.authorization
        ? [
            {
              type: "payment.allowed_payment_instruments" as const,
              allowed: [instrumentOf(m.authorization.id)],
            },
          ]
        : []),
      { type: "payment.execution_date", not_after: m.terms.validUntil.toISOString() },
      {
        type: "payment.reference",
        conditional_transaction_id: sha256(JSON.stringify(checkout)),
      },
    ],
    cnf: {},
    iat,
    exp,
  };
  return { checkout, payment };
};

const instrumentOf = (authorizationId: string): PaymentInstrument => ({
  id: authorizationId,
  type: "paypal.authorization",
  description: "PayPal authorization hold approved by the buyer",
});

const closedMandates = (m: Mandate, bought: AuditEntry) => {
  const productId = bought.data?.productId ?? "";
  const shop = bought.data?.merchant ?? "";
  const chosen = m.terms.candidates.find(
    (c) =>
      c.productId === productId && shopsOf(c).some((s) => s.toLowerCase() === shop.toLowerCase()),
  );
  // A limit mandate captures exactly once, so the captured total is the item price.
  const price = m.captured.cents;
  const totals = [
    { type: "subtotal", amount: price },
    { type: "total", amount: price },
  ];
  // The Universal Commerce Protocol Checkout object, the payload AP2 names for checkout_jwt.
  const checkout = {
    id: m.id,
    merchant: merchantOf(shop),
    line_items: [
      {
        id: "item_1",
        item: { id: productId, title: chosen ? titleOf(chosen) : productId, price },
        quantity: 1,
        totals,
      },
    ],
    status: "completed",
    currency: "USD",
    totals,
    links: [],
  };
  const checkoutJwt = `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(JSON.stringify(checkout))}.`;
  const checkoutHash = sha256(checkoutJwt);
  const iat = epoch(bought.at);
  const checkoutMandate: Ap2CheckoutMandate = {
    vct: "mandate.checkout.1",
    checkout_jwt: checkoutJwt,
    checkout_hash: checkoutHash,
    iat,
  };
  const paymentMandate: Ap2PaymentMandate = {
    vct: "mandate.payment.1",
    transaction_id: checkoutHash,
    payee: PAYEE,
    payment_amount: { amount: price, currency: m.captured.currency },
    payment_instrument: instrumentOf(m.authorization?.id ?? ""),
    execution_date: bought.at.toISOString(),
    iat,
  };
  return { checkoutMandate, paymentMandate };
};

export const toAp2 = (m: Mandate, audit: AuditEntry[]): Ap2Export => {
  const open = openMandates(m);
  const bought = audit.find((e) => e.kind === "proposal_allowed");
  const closed = bought && m.captured.cents > 0 ? closedMandates(m, bought) : null;
  return {
    protocol: "AP2",
    version: "0.2",
    spec: "https://ap2-protocol.org/",
    mode: "human_not_present",
    signed: false,
    note: AP2_NOTE,
    entole: {
      mandateId: m.id,
      status: m.status,
      digest: m.digest,
      digestAlgorithm: "sha-256",
      paypal: {
        orderId: audit.find((e) => e.kind === "created")?.data?.orderId ?? null,
        customId: m.digest,
        authorizationId: m.authorization?.id ?? null,
        captureId: bought?.data?.captureId ?? null,
        refundId: m.refund?.id ?? null,
      },
    },
    openCheckoutMandate: open.checkout,
    openPaymentMandate: open.payment,
    checkoutMandate: closed?.checkoutMandate ?? null,
    paymentMandate: closed?.paymentMandate ?? null,
  };
};
