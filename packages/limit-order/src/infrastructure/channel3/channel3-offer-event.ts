import { type Money, usdFromDollars } from "@entole/shared-kernel";
import type { OfferEvent } from "../../domain/offer-event.ts";

// The events each product subscription asks Channel3 for.
export const CHANNEL3_OFFER_EVENTS = ["offer.price.changed", "offer.availability.changed"] as const;

// Not subscribed per product, but a new cheaper offer can still wake an order.
type ParsedType = (typeof CHANNEL3_OFFER_EVENTS)[number] | "offer.created";

export type Channel3Translation =
  | { kind: "event"; event: OfferEvent }
  | { kind: "ignored"; id: string; type: string; reason: string };

// Only for a delivery whose structure is broken; an event Entole has no use for is "ignored".
export class InvalidOfferEvent extends Error {
  constructor(field: string) {
    super(`Invalid Channel3 offer event: ${field}`);
    this.name = "InvalidOfferEvent";
  }
}

type Obj = Record<string, unknown>;

const invalid = (field: string): never => {
  throw new InvalidOfferEvent(field);
};

const obj = (v: unknown, field: string): Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : invalid(field);

const str = (v: unknown, field: string): string =>
  typeof v === "string" && v !== "" ? v : invalid(field);

// Event ids end up in Render idempotency keys and the audit log, so an oversized one is refused.
const MAX_ID = 128;

const isParsed = (type: string): type is ParsedType =>
  type === "offer.created" || (CHANNEL3_OFFER_EVENTS as readonly string[]).includes(type);

// Channel3 sends prices as JSON floats; Entole is USD only and counts integer cents. Null: not USD.
const usdPrice = (p: unknown, field: string): Money | null => {
  const { price, currency } = obj(p, field);
  if (currency !== "USD") return null;
  if (typeof price !== "number") return invalid(field);
  try {
    // The event price only decides when to look; the woken check re-quotes before any capture.
    return usdFromDollars(price);
  } catch {
    return invalid(field);
  }
};

// Maps one parsed Channel3 offer webhook to the domain's OfferEvent.
export const translateChannel3Event = (body: unknown): Channel3Translation => {
  const e = obj(body, "body");
  const id = str(e.id, "id");
  if (id.length > MAX_ID) invalid("id");
  const type = str(e.type, "type");
  const ignore = (reason: string): Channel3Translation => ({ kind: "ignored", id, type, reason });
  if (!isParsed(type)) return ignore("unhandled type");
  const d = obj(e.data, "data");
  const subject = obj(d.subject, "subject");
  if (obj(subject.locale, "locale").currency !== "USD") return ignore("not USD");
  const base = {
    id,
    productId: str(subject.product_id, "product_id"),
    domain: str(subject.domain, "domain"),
  };
  const withPrice = (
    kind: "price" | "created",
    price: Money | null,
    inStock: boolean | null,
  ): Channel3Translation =>
    price ? { kind: "event", event: { ...base, kind, price, inStock } } : ignore("not USD");
  switch (type) {
    case "offer.price.changed":
      return withPrice("price", usdPrice(d.current, "current"), null);
    case "offer.availability.changed":
      return {
        kind: "event",
        event: {
          ...base,
          kind: "availability",
          price: null,
          inStock: str(d.current, "current") === "InStock",
        },
      };
    case "offer.created": {
      const offer = obj(d.offer, "offer");
      return withPrice("created", usdPrice(offer.price, "price"), offer.availability === "InStock");
    }
  }
};
