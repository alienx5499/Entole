import type { ProductSearch } from "@entole/mandate/core";
import { formatUsd, usd } from "@entole/shared-kernel";
import type { AgentToolSpec } from "./ports.ts";

export const AGENT_TOOLS: AgentToolSpec[] = [
  {
    name: "search_products",
    description:
      "Search the product catalog. Returns at most 5 products with their offers and options.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_price: { type: "number", description: "Optional price ceiling in US dollars" },
      },
      required: ["query"],
    },
  },
];

export const parseArgs = (json: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(json);
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

export const INVALID = JSON.stringify({ error: "invalid arguments" });
export const isString = (v: unknown): v is string => typeof v === "string";

export const searchTool = async (
  deps: { search: ProductSearch },
  a: Record<string, unknown>,
): Promise<string> => {
  const maxPrice = a.max_price;
  if (
    !isString(a.query) ||
    (maxPrice !== undefined &&
      (typeof maxPrice !== "number" || !(maxPrice >= 0) || !Number.isFinite(maxPrice)))
  )
    return INVALID;
  const found = await deps.search.search({
    query: a.query,
    maxPrice: typeof maxPrice === "number" ? usd(Math.round(maxPrice * 100)) : undefined,
    limit: 5,
  });
  return JSON.stringify(
    found.slice(0, 5).map((p) => ({
      productId: p.productId,
      title: p.title,
      offers: p.offers.map((o) => ({ merchant: o.merchant, price: formatUsd(o.price) })),
      options: p.options,
      description: p.description.slice(0, 300),
    })),
  );
};
