import { expect, test } from "bun:test";
import type { AuditEntry, Candidate, Mandate } from "@entole/mandate";
import { usd } from "@entole/shared-kernel";
import { mandateView } from "../src/http/views.ts";

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 26, 12, minutes));
const candidate = (productId: string, title: string, cents: number): Candidate => ({
  productId,
  merchant: "shop.example",
  merchants: ["shop.example", "other.example"],
  options: { Size: "10" },
  title,
  baselinePrice: usd(cents),
});

// Every purchase and receipt field set, so a change to any formatting shows up here.
const mandate: Mandate = {
  id: "m1",
  ownerId: "u1",
  createdAt: at(0),
  terms: {
    kind: "limit",
    item: { query: "trail shoes", requiredAttributes: { Size: "10" }, brands: [], avoid: [] },
    candidates: [
      candidate("p1", "Trail Runner 2", 18000),
      candidate("p2", "Blocked Shoe", 16500),
      candidate("p3", "Pricey Shoe", 19900),
      candidate("p4", "Cheap Shoe", 15000),
    ],
    maxUnitPrice: usd(17000),
    budget: usd(17000),
    allowedMerchants: [],
    validUntil: at(3 * 24 * 60),
  },
  digest: "d1",
  status: "closed",
  authorization: { id: "auth-2", amount: usd(17000), expiresAt: at(29 * 24 * 60) },
  captured: usd(16900),
  voided: true,
  demoInjection: false,
  replay: true,
  rejected: [],
  refund: { id: "refund-1", amount: usd(16900) },
  shipTo: {
    name: "Ada Buyer",
    lines: ["1 Main St"],
    city: "Austin",
    region: "TX",
    postalCode: "78701",
    country: "US",
  },
};

const audit: AuditEntry[] = [
  { at: at(0), kind: "created", message: "Created", data: { orderId: "order-1" } },
  { at: at(5), kind: "funded", message: "Funded" },
  {
    at: at(6),
    kind: "paypal_event",
    message: "Authorization created",
    data: { eventType: "PAYMENT.AUTHORIZATION.CREATED", eventId: "WH-1" },
  },
  {
    at: at(10),
    kind: "hold_renewed",
    message: "Renewed",
    data: { authorizationId: "auth-2", previousAuthorizationId: "auth-1" },
  },
  {
    at: at(20),
    kind: "proposal_blocked",
    message: "Merchant not allowed; Price above limit",
    data: { productId: "p2", merchant: "OTHER.example" },
  },
  {
    at: at(30),
    kind: "proposal_allowed",
    message: "Bought",
    data: {
      productId: "p1",
      merchant: "shop.example",
      shopsCompared: "2",
      captureId: "cap-1",
      paypalStatus: "COMPLETED",
      sellerProtection: "ELIGIBLE",
      paypalFee: "5.20",
      net: "163.80",
    },
  },
  { at: at(31), kind: "closed", message: "Closed", data: { voided: "1.00" } },
  { at: at(40), kind: "refunded", message: "Refunded" },
];

test("the purchase and receipt views keep their exact JSON", () => {
  const v = mandateView(mandate, audit, null, at(50), null);
  expect(JSON.stringify({ purchase: v.purchase, receipt: v.receipt })).toBe(FULL);
});

// Rows written before PayPal's answer, shops or ship-to were recorded: every fallback at once.
test("the purchase and receipt views keep their fallbacks", () => {
  const bare: Mandate = {
    ...mandate,
    status: "funded",
    authorization: undefined,
    refund: undefined,
    shipTo: undefined,
    voided: false,
    replay: false,
  };
  const v = mandateView(
    bare,
    [{ at: at(30), kind: "proposal_allowed", message: "Bought", data: { productId: "gone" } }],
    null,
    at(50),
    null,
  );
  expect(JSON.stringify({ purchase: v.purchase, receipt: v.receipt })).toBe(FALLBACKS);
  const none = mandateView({ ...bare, captured: usd(0) }, [], null, at(50), null);
  expect(JSON.stringify({ purchase: none.purchase, receipt: none.receipt })).toBe(NOTHING_YET);
});

// Captured from the views before the receipt and purchase moved into the mandate application.
const FULL =
  '{"purchase":{"productId":"p1","title":"Trail Runner 2","merchant":"shop.example","shopsCompared":2,"price":"169.00","captureId":"cap-1","paypal":{"status":"COMPLETED","sellerProtection":"ELIGIBLE","fee":"5.20","net":"163.80"},"shipTo":{"name":"Ada Buyer","lines":["1 Main St"],"city":"Austin","region":"TX","postalCode":"78701","country":"US"},"savings":"11.00","inReplay":true,"whyThisOne":{"chosen":"Trail Runner 2: $169.00, at or below your $170.00 limit","skipped":[{"title":"Blocked Shoe","reasons":["Merchant not allowed","Price above limit"]},{"title":"Pricey Shoe","reasons":["Price stayed above your $170.00 limit"]},{"title":"Cheap Shoe","reasons":["Another item was bought first"]}]}},"receipt":{"paypalOrderId":"order-1","authorizationId":"auth-2","captureId":"cap-1","refundId":"refund-1","customId":"d1","holdRenewed":{"at":"2026-10-26T12:10:00.000Z","authorizationId":"auth-2","previousAuthorizationId":"auth-1"},"amounts":{"held":"170.00","captured":"169.00","released":"1.00","refunded":"169.00"},"times":{"approved":"2026-10-26T12:05:00.000Z","captured":"2026-10-26T12:30:00.000Z","released":"2026-10-26T12:31:00.000Z","refunded":"2026-10-26T12:40:00.000Z"},"confirmations":[{"at":"2026-10-26T12:06:00.000Z","eventType":"PAYMENT.AUTHORIZATION.CREATED","message":"Authorization created","eventId":"WH-1"}]}}';
const FALLBACKS =
  '{"purchase":{"productId":"gone","title":"gone","merchant":"","shopsCompared":1,"price":"169.00","captureId":"","paypal":{"status":null,"sellerProtection":null,"fee":null,"net":null},"shipTo":null,"savings":"0.00","inReplay":false,"whyThisOne":{"chosen":"gone: $169.00, at or below your $170.00 limit","skipped":[{"title":"Trail Runner 2","reasons":["Price stayed above your $170.00 limit"]},{"title":"Blocked Shoe","reasons":["Another item was bought first"]},{"title":"Pricey Shoe","reasons":["Price stayed above your $170.00 limit"]},{"title":"Cheap Shoe","reasons":["Another item was bought first"]}]}},"receipt":{"paypalOrderId":null,"authorizationId":null,"captureId":null,"refundId":null,"customId":"d1","holdRenewed":null,"amounts":{"held":"0.00","captured":"169.00","released":"0.00","refunded":"0.00"},"times":{"approved":null,"captured":"2026-10-26T12:30:00.000Z","released":null,"refunded":null},"confirmations":[]}}';
const NOTHING_YET =
  '{"purchase":null,"receipt":{"paypalOrderId":null,"authorizationId":null,"captureId":null,"refundId":null,"customId":"d1","holdRenewed":null,"amounts":{"held":"0.00","captured":"0.00","released":"0.00","refunded":"0.00"},"times":{"approved":null,"captured":null,"released":null,"refunded":null},"confirmations":[]}}';
