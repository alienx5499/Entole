// The dashboard's custom Studio widgets: their registry types, format shape and menu group.

import type {
  AgBaseRegistry,
  AgBaseWidgetDefinition,
  AgDefaultWidgetDefinition,
  AgFormatShapeParams,
  AgShapeBuilder,
  AgWidgetDataFormat,
  AgWidgetMenuGroup,
} from "ag-studio";

// Both read their own fields from the schema, so they take no data mapping. Their format is what
// the default form edits: titles and the cross filter setting.
type EntoleFormat = Pick<
  AgWidgetDataFormat<never>,
  "title" | "subtitle" | "caption" | "crossFilter"
>;
type NoMapping<T extends string> = {
  type: T;
  dataMapping: Record<string, never>;
  format?: EntoleFormat;
};
export type OrdersGridDef = NoMapping<"orders-grid">;
export type PriceChartDef = NoMapping<"price-chart">;

export interface EntoleRegistry extends AgBaseRegistry {
  widgets: readonly (
    | AgDefaultWidgetDefinition
    | AgBaseWidgetDefinition<"orders-grid", OrdersGridDef>
    | AgBaseWidgetDefinition<"price-chart", PriceChartDef>
  )[];
}

const titleShape = (s: AgShapeBuilder) =>
  s
    .object({
      enabled: s.boolean().optional(),
      text: s.string().optional(),
      typography: s
        .object({
          fontFamily: s.string().optional(),
          fontSize: s.number().optional(),
          fontWeight: s.enum(["normal", "bold"]).optional(),
          fontStyle: s.enum(["normal", "italic"]).optional(),
        })
        .optional(),
      color: s.string().optional(),
      textAlign: s.enum(["left", "center", "right"]).optional(),
      wrapping: s.boolean().optional(),
    })
    .optional();

/**
 * The format both custom widgets accept. Studio's agents need it to add or configure them, and it
 * parses saved format, so it declares every field the default form writes (others are dropped).
 * ag-studio exports no standalone shape builder; a command factory is the public way to get one.
 */
export const entoleFormatShape = ({ api }: AgFormatShapeParams) =>
  api.defineAiCommand((s) => ({
    input: s.object({
      title: titleShape(s),
      subtitle: titleShape(s),
      caption: titleShape(s),
      crossFilter: s.enum(["highlight", "filter", "none"]).optional(),
    }),
    execute: () => ({ success: true, value: undefined }),
  })).shape;

const icon = (paths: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 32 32">${paths}<path fill="var(--ag-border-color, #b3b4b4)" d="M1 31h31v1H0V0h1z"/></svg>`;

// Everything but the React component, which Dashboard.tsx adds.
export const ordersGridWidget = {
  id: "orders-grid",
  label: "Orders grid",
  icon: icon(
    '<path fill="var(--ag-chart-palette-fills-1-color, #5090dc)" d="M3 3h27v6H3z"/><path fill="var(--ag-chart-palette-fills-4-color, #1b1f3a)" d="M3 12h27v2H3zm0 6h27v2H3zm0 6h27v2H3z"/>',
  ),
  formatShape: entoleFormatShape,
  form: (p) => p.createDefaults({ dataMappingItems: [] }),
  defaultSize: { width: 800, height: 400 },
  minSize: { width: 360, height: 220 },
  ai: {
    description: "Every limit order with its outcome tag; a click filters the page to it.",
    usage:
      "Use to list the shopper's orders: order, outcome, limit, paid and saved, with shop, created and valid until in the column menu. It needs no data mapping: it always shows every order. Prefer it over a generic grid for orders.",
  },
} satisfies Omit<AgBaseWidgetDefinition<"orders-grid", OrdersGridDef>, "comp">;

export const priceChartWidget = {
  id: "price-chart",
  label: "Price history",
  icon: icon(
    '<path stroke="var(--ag-chart-palette-fills-2-color, #c8312b)" stroke-dasharray="3 2" stroke-width="2" d="M2 12h29"/><path stroke="var(--ag-chart-palette-fills-1-color, #5090dc)" stroke-width="2" d="m2 6 7 8 6-4 7 12 9 4"/>',
  ),
  formatShape: entoleFormatShape,
  form: (p) => p.createDefaults({ dataMappingItems: [] }),
  defaultSize: { width: 600, height: 400 },
  minSize: { width: 300, height: 220 },
  ai: {
    description: "Price history of one order's items against its limit line.",
    usage:
      "Use to show how prices moved against the shopper's signed limit. It needs no data mapping: it reads the price history table and follows the order picked in the orders grid; with none picked, the order with the newest price point.",
  },
} satisfies Omit<AgBaseWidgetDefinition<"price-chart", PriceChartDef>, "comp">;

// Its own group in the Widgets tab; also the list Studio's agents pick widget types from.
export const ENTOLE_MENU: AgWidgetMenuGroup<EntoleRegistry> = {
  label: "Entole",
  widgetIds: [ordersGridWidget.id, priceChartWidget.id],
};
