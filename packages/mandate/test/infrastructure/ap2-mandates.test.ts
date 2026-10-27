import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { usd } from "@entole/shared-kernel";
import { type AuditEntry, type Mandate, newMandate, toAp2 } from "../../src/index.ts";

const now = new Date("2026-10-26T00:00:00Z");
const validUntil = new Date("2026-10-28T00:00:00Z");
const open = (): Mandate =>
  newMandate({
    id: "m1",
    ownerId: "u1",
    now,
    terms: {
      kind: "limit",
      item: { query: "trail shoes", requiredAttributes: { Size: "10" }, brands: [], avoid: [] },
      candidates: [
        {
          productId: "p1",
          merchant: "shop.example",
          merchants: ["shop.example", "Other Shop"],
          options: { Size: "10" },
          title: "Trail Runner 2",
          baselinePrice: usd(18000),
        },
        {
          productId: "p2",
          merchant: "shop.example",
          options: {},
          title: "Ridge 5",
          baselinePrice: usd(17500),
        },
      ],
      maxUnitPrice: usd(17000),
      budget: usd(17000),
      allowedMerchants: [],
      validUntil,
    },
  });
const boughtAt = new Date("2026-10-27T12:00:00Z");
const audit: AuditEntry[] = [
  { at: now, kind: "created", message: "", data: { digest: "d", orderId: "ORDER-1" } },
  {
    at: boughtAt,
    kind: "proposal_allowed",
    message: "",
    data: { productId: "p1", merchant: "Other Shop", captureId: "CAP-1" },
  },
];
const sha = (s: string) => createHash("sha256").update(s).digest("base64url");

test("an unfunded order maps to open AP2 v0.2 mandates and no closed ones", () => {
  const m = open();
  const out = toAp2(m, audit.slice(0, 1));
  expect(out).toMatchObject({ protocol: "AP2", version: "0.2", signed: false });
  expect(out.entole.paypal).toEqual({
    orderId: "ORDER-1",
    customId: m.digest,
    authorizationId: null,
    captureId: null,
    refundId: null,
  });
  expect(out.openCheckoutMandate).toEqual({
    vct: "mandate.checkout.open.1",
    constraints: [
      {
        type: "checkout.allowed_merchants",
        allowed: [
          { id: "shop.example", name: "shop.example", website: "https://shop.example" },
          { id: "Other Shop", name: "Other Shop" },
        ],
      },
      {
        type: "checkout.line_items",
        items: [
          {
            id: "item_1",
            acceptable_items: [
              { id: "p1", title: "Trail Runner 2 (Size 10)" },
              { id: "p2", title: "Ridge 5" },
            ],
            quantity: 1,
          },
        ],
      },
    ],
    cnf: {},
    iat: now.getTime() / 1000,
    exp: validUntil.getTime() / 1000,
  });
  const pay = out.openPaymentMandate;
  expect(pay.vct).toBe("mandate.payment.open.1");
  expect(pay.constraints).toContainEqual({
    type: "payment.amount_range",
    currency: "USD",
    max: 17000,
  });
  expect(pay.constraints).toContainEqual({
    type: "payment.reference",
    conditional_transaction_id: sha(JSON.stringify(out.openCheckoutMandate)),
  });
  expect(pay.constraints.some((c) => c.type === "payment.allowed_payment_instruments")).toBe(false);
  expect(out.checkoutMandate).toBeNull();
  expect(out.paymentMandate).toBeNull();
});

test("a captured order adds closed mandates bound by the checkout hash", () => {
  const m: Mandate = {
    ...open(),
    status: "closed",
    authorization: { id: "AUTH-1", amount: usd(17000), expiresAt: validUntil },
    captured: usd(16900),
  };
  const out = toAp2(m, audit);
  expect(out.entole.paypal.captureId).toBe("CAP-1");
  expect(out.openPaymentMandate.constraints).toContainEqual({
    type: "payment.allowed_payment_instruments",
    allowed: [{ id: "AUTH-1", type: "paypal.authorization", description: expect.any(String) }],
  });
  const cm = out.checkoutMandate;
  if (!cm) throw new Error("expected a closed checkout mandate");
  expect(cm.vct).toBe("mandate.checkout.1");
  expect(cm.checkout_hash).toBe(sha(cm.checkout_jwt));
  const [header, payload, signature] = cm.checkout_jwt.split(".");
  expect(JSON.parse(Buffer.from(header ?? "", "base64url").toString())).toEqual({
    alg: "none",
    typ: "JWT",
  });
  expect(signature).toBe("");
  expect(JSON.parse(Buffer.from(payload ?? "", "base64url").toString())).toMatchObject({
    merchant: { id: "Other Shop" },
    line_items: [{ item: { id: "p1", price: 16900 }, quantity: 1 }],
    currency: "USD",
    status: "completed",
  });
  expect(out.paymentMandate).toEqual({
    vct: "mandate.payment.1",
    transaction_id: cm.checkout_hash,
    payee: { id: "entole", name: "Entole" },
    payment_amount: { amount: 16900, currency: "USD" },
    payment_instrument: {
      id: "AUTH-1",
      type: "paypal.authorization",
      description: expect.any(String),
    },
    execution_date: boughtAt.toISOString(),
    iat: boughtAt.getTime() / 1000,
  });
});
