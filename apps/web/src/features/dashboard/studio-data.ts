// The tables the dashboard reads. Field ids ('orders.saved') refer to these tables.

import type { AgDataSourcesDefinition, AgFieldDefinition, AgFormat } from "ag-studio";
import type { DashboardData } from "./load";
import type { EntoleRegistry } from "./studio-widgets";

// No field is hidden: the custom widgets read ids from the schema, which leaves hidden fields out.
type FieldSpec = [id: string, name: string, format: AgFormat];
const USD = { format: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }) };
const fields = (specs: FieldSpec[]): AgFieldDefinition[] =>
  specs.map(([id, name, format]) => ({
    id,
    name,
    format,
    ...(format === "currencyFormat" && { formatOptions: USD }),
  }));

type Source = AgDataSourcesDefinition<EntoleRegistry>["sources"][number];

function ordersSource(orders: DashboardData["orders"]): Source {
  return {
    id: "orders",
    description: "One row per limit order.",
    data: orders,
    fields: fields([
      ["id", "Order ID", "textFormat"],
      ["order", "Order", "textFormat"],
      ["shop", "Shop", "textFormat"],
      ["product", "Product", "textFormat"],
      ["outcome", "Outcome", "textFormat"],
      ["outcomeKey", "Outcome key", "textFormat"],
      ["limit", "Limit", "currencyFormat"],
      ["paid", "Paid", "currencyFormat"],
      ["saved", "Saved", "currencyFormat"],
      ["held", "Hold amount", "currencyFormat"],
      ["heldNow", "Held now", "currencyFormat"],
      ["spent", "Spent", "currencyFormat"],
      ["isBought", "Bought", "integerFormat"],
      ["isReleased", "Released", "integerFormat"],
      ["createdAt", "Created", "dateFormat"],
      ["validUntil", "Valid until", "dateFormat"],
    ]),
  };
}

function purchasesSource(orders: DashboardData["orders"]): Source {
  return {
    id: "purchases",
    name: "Purchases",
    description: "One row per order that bought an item: where, what it cost and what it saved.",
    // Only real purchases, so the shop chart has no empty rows for orders that never bought.
    data: orders
      .filter((o) => o.spent > 0)
      .map((o) => ({ id: o.id, shop: o.shop, saved: o.saved, spent: o.spent })),
    fields: fields([
      ["id", "Order ID", "textFormat"],
      ["shop", "Shop", "textFormat"],
      ["saved", "Saved", "currencyFormat"],
      ["spent", "Spent", "currencyFormat"],
    ]),
  };
}

function pricesSource(prices: DashboardData["prices"]): Source {
  return {
    id: "prices",
    name: "Price history",
    description: "Every price the agent saw for each candidate item, with the order's limit.",
    data: prices,
    fields: fields([
      ["id", "Point ID", "textFormat"],
      ["orderId", "Order ID", "textFormat"],
      ["product", "Item", "textFormat"],
      ["at", "Seen at", "dateTimeFormat"],
      ["price", "Price", "currencyFormat"],
      ["limit", "Limit price", "currencyFormat"],
    ]),
  };
}

export function buildData({
  orders,
  prices,
}: DashboardData): AgDataSourcesDefinition<EntoleRegistry> {
  return {
    description:
      "A shopper's Entole limit orders. Each order holds money on PayPal up to its limit and an agent buys only at or under it. Money is USD.",
    sources: [ordersSource(orders), purchasesSource(orders), pricesSource(prices)],
    relationships: [
      {
        id: "purchase-order",
        source: { tableId: "purchases", fieldId: "id" },
        target: { tableId: "orders", fieldId: "id" },
        type: "many-to-one",
      },
      {
        id: "price-order",
        source: { tableId: "prices", fieldId: "orderId" },
        target: { tableId: "orders", fieldId: "id" },
        type: "many-to-one",
      },
    ],
  };
}
