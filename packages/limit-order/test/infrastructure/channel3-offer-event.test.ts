import { expect, test } from "bun:test";
import { parseUsd } from "@entole/shared-kernel";
import { InvalidOfferEvent, translateChannel3Event } from "../../src/index.ts";

const subject = {
  product_id: "p_1",
  domain: "nike.com",
  locale: { language: "en", country: "US", currency: "USD" },
  selection: null,
};

const envelope = (type: string, data: Record<string, unknown>) => ({
  id: "evt_1",
  timestamp: "2026-11-01T10:00:00Z",
  type,
  data: { subscription_id: "sub_1", subject, ...data },
});

const price = (p: number, currency = "USD") => ({ price: p, compare_at_price: null, currency });

const offer = (currency = "USD") => ({
  url: "https://nike.com/p/1",
  domain: "nike.com",
  price: { price: 149.99, compare_at_price: 189.99, currency },
  availability: "InStock",
  condition: "New",
});

const base = { id: "evt_1", productId: "p_1", domain: "nike.com" };

const rejects = (e: unknown) => expect(() => translateChannel3Event(e)).toThrow(InvalidOfferEvent);

const ignored = (e: unknown) =>
  expect(translateChannel3Event(e)).toMatchObject({ kind: "ignored", id: "evt_1" });

test("maps a price change to the current price in cents", () => {
  const raw =
    '{"id":"evt_1","timestamp":"2026-11-01T10:00:00Z","type":"offer.price.changed","data":{"subscription_id":"sub_1","subject":{"product_id":"p_1","domain":"nike.com","locale":{"language":"en","country":"US","currency":"USD"},"selection":null},"previous":{"price":189.99,"compare_at_price":null,"currency":"USD"},"current":{"price":149.99,"compare_at_price":189.99,"currency":"USD"}}}';
  expect(translateChannel3Event(JSON.parse(raw))).toEqual({
    kind: "event",
    event: { ...base, kind: "price", price: parseUsd("149.99"), inStock: null },
  });
});

test("maps an availability change to inStock", () => {
  expect(
    translateChannel3Event(
      envelope("offer.availability.changed", { previous: "OutOfStock", current: "InStock" }),
    ),
  ).toEqual({
    kind: "event",
    event: { ...base, kind: "availability", price: null, inStock: true },
  });
  expect(
    translateChannel3Event(
      envelope("offer.availability.changed", { previous: "InStock", current: "OutOfStock" }),
    ),
  ).toEqual({
    kind: "event",
    event: { ...base, kind: "availability", price: null, inStock: false },
  });
});

test("maps a created offer with its price", () => {
  expect(translateChannel3Event(envelope("offer.created", { offer: offer() }))).toEqual({
    kind: "event",
    event: { ...base, kind: "created", price: parseUsd("149.99"), inStock: true },
  });
});

test("ignores a deleted offer", () => {
  ignored(envelope("offer.deleted", { offer: offer() }));
});

test("ignores EUR", () => {
  ignored(envelope("offer.price.changed", { previous: price(1), current: price(1, "EUR") }));
  ignored(envelope("offer.created", { offer: offer("EUR") }));
  ignored({
    ...envelope("offer.availability.changed", { current: "InStock" }),
    data: {
      subscription_id: "s",
      subject: { ...subject, locale: { ...subject.locale, currency: "EUR" } },
      current: "InStock",
    },
  });
});

test("ignores an unknown type", () => {
  ignored(envelope("offer.renamed", {}));
});

test("rejects a missing id, type or product_id", () => {
  rejects({ ...envelope("offer.created", { offer: offer() }), id: undefined });
  rejects({ ...envelope("offer.created", { offer: offer() }), type: 7 });
  rejects({
    ...envelope("offer.availability.changed", {}),
    data: { subscription_id: "s", subject: { ...subject, product_id: undefined }, current: "x" },
  });
  rejects([]);
  rejects({ ...envelope("offer.created", { offer: offer() }), id: "e".repeat(129) });
  expect(
    translateChannel3Event({
      ...envelope("offer.created", { offer: offer() }),
      id: "e".repeat(128),
    }).kind,
  ).toBe("event");
});

test("rejects negative, non-numeric or missing prices", () => {
  rejects(envelope("offer.price.changed", { current: price(-1) }));
  rejects(envelope("offer.price.changed", { current: { price: "149.99", currency: "USD" } }));
  rejects(envelope("offer.price.changed", {}));
});
