// AG Studio setup for the dashboard: the two tables, the sketch theme and the report it opens on.
// Field ids ('orders.saved') refer to the tables in buildData.

import type {
  AgBaseRegistry,
  AgBaseWidgetDefinition,
  AgDataSourcesDefinition,
  AgDefaultWidgetDefinition,
  AgFieldDefinition,
  AgFormat,
  AgFormatShapeParams,
  AgReportState,
  AgShapeBuilder,
  AgWidgetDataFormat,
  AgWidgetLayoutState,
  AgWidgetMenuGroup,
} from "ag-studio";
import { studioTheme } from "ag-studio";
import type { DashboardData } from "./load";

// --- Custom widgets ------------------------------------------------------------------

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

// --- Data ----------------------------------------------------------------------------

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

export function buildData({
  orders,
  prices,
}: DashboardData): AgDataSourcesDefinition<EntoleRegistry> {
  return {
    description:
      "A shopper's Entole limit orders. Each order holds money on PayPal up to its limit and an agent buys only at or under it. Money is USD.",
    sources: [
      {
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
      },
      {
        id: "purchases",
        name: "Purchases",
        description:
          "One row per order that bought an item: where, what it cost and what it saved.",
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
      },
      {
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
      },
    ],
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

// --- Theme ---------------------------------------------------------------------------

const INK = "#2b2a28";
const INK_SOFT = "#55524c";
const NAVY = "#1b1f3a";
const COBALT = "#1f3fbf";
const BLUE = "#2f5fd0";
const RED = "#c8312b";
const YELLOW = "#f5d547";
const IVORY = "#f7f2e7";
const CARD = "#fffdf6";
const BODY = 'var(--font-body), "Comic Sans MS", cursive';
const HEADING = 'var(--font-heading), "Comic Sans MS", cursive';
const MONO = "var(--font-mono), ui-monospace, monospace";

export const CHART_COLORS = [COBALT, RED, "#d9a400", NAVY, BLUE, "#5c8a4d", "#8a5cc2", INK_SOFT];

const palette = Object.fromEntries(
  CHART_COLORS.flatMap((c, i) => [
    [`chartPaletteFills${i + 1}Color`, c],
    [`chartPaletteStrokes${i + 1}Color`, c],
  ]),
);

const line = (color: string, width = 2) => ({ width, color });

export const sketchTheme = studioTheme.withParams({
  fontFamily: BODY,
  fontSize: 15,
  textColor: INK,
  foregroundColor: INK,
  subtleTextColor: INK_SOFT,
  backgroundColor: CARD,
  borderColor: INK,
  accentColor: COBALT,
  iconColor: NAVY,
  rowHoverColor: "#fff8dc",

  // The canvas is the page's paper; widgets are the app's ink-bordered cards.
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: "transparent",
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: "transparent",
  studioCanvasPadding: 12,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: BODY,

  studioWidgetBackgroundColor: CARD,
  studioWidgetBorder: line(INK),
  studioWidgetBorderRadius: 14,
  studioWidgetPadding: 12,
  studioWidgetTitleFontFamily: HEADING,
  studioWidgetTitleFontSize: 22,
  studioWidgetTitleFontWeight: 400,
  studioWidgetTitleTextColor: NAVY,
  studioWidgetSubtitleFontFamily: BODY,
  studioWidgetSubtitleFontSize: 14,
  studioWidgetSubtitleTextColor: INK_SOFT,
  studioWidgetCaptionFontFamily: BODY,
  studioWidgetCaptionFontSize: 13,
  studioWidgetCaptionTextColor: INK_SOFT,
  studioWidgetResizeBorderColor: COBALT,

  studioPanelContainerBackgroundColor: IVORY,
  studioPanelContainerBorder: line(INK),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: INK,
  studioPanelDividerActiveColor: COBALT,
  studioPanelSectionBorderColor: "#d8cfb8",
  studioPanelHeaderFontFamily: HEADING,
  studioPanelHeaderFontWeight: 400,
  studioPanelChevronButtonHoverBackgroundColor: YELLOW,
  studioPanelChevronButtonHoverColor: NAVY,
  studioToggleButtonActiveBackgroundColor: YELLOW,
  studioToggleButtonActiveBorderColor: INK,
  studioToggleButtonActiveColor: NAVY,

  gridFontFamily: BODY,
  gridFontSize: 15,
  gridCellTextColor: INK,
  gridHeaderBackgroundColor: IVORY,
  gridHeaderTextColor: NAVY,
  gridHeaderFontWeight: 700,
  gridHeaderFontSize: 14,
  gridRowHeight: 42,
  gridRowBorder: line("#e4dcc6", 1),
  gridHeaderRowBorder: line(INK),
  gridPinnedRowBorder: line(INK),
  gridRowHoverColor: "#fff8dc",
  gridWrapperBorder: false,

  chartFontFamily: BODY,
  chartTextColor: INK,
  chartSubtleTextColor: INK_SOFT,
  chartAxisLineColor: INK,
  chartGridLineColor: "#e4dcc6",
  ...palette,
});

export const SKETCH = { INK, INK_SOFT, NAVY, COBALT, RED, YELLOW, CARD, BODY, MONO };

// --- Report --------------------------------------------------------------------------

// Canvas tracks: 24 columns wide, rows of studioCanvasRowHeight.
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({
  xTrack,
  yTrack,
  xSpan,
  ySpan,
});
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: "sum" as const });
const countd = (id: string) => ({ id, aggregation: "countd" as const });

const typography = (fontFamily: string, fontSize: number) => ({
  fontFamily,
  fontSize,
  fontWeight: "normal" as const,
  fontStyle: "normal" as const,
});

const kpi = (text: string, field: string, note = "") => ({
  type: "value" as const,
  dataMapping: { value: [sum(field)] },
  format: {
    title: { enabled: true, text, typography: typography(HEADING, 20) },
    caption: { enabled: true, text: note, typography: typography(BODY, note ? 13 : 0) },
    style: { typography: typography(MONO, 26) },
  },
});

export const initialReport: AgReportState<EntoleRegistry> = {
  selectedPageId: "overview",
  // The AI panel opens from its edge tab, so the report keeps its full width until asked.
  panels: { filters: { collapsed: true }, ai: { collapsed: true } },
  pages: [
    {
      id: "overview",
      widgets: {
        "kpi-held": kpi("Held now", "orders.heldNow"),
        "kpi-spent": kpi("Spent", "orders.spent"),
        // Savings count kept purchases only: a refunded order saved nothing.
        "kpi-saved": kpi("Saved", "orders.saved", "vs list price, kept orders"),
        "kpi-bought": kpi("Bought", "orders.isBought"),
        "kpi-released": kpi("Released", "orders.isReleased"),
        outcome: {
          type: "button-filter",
          dataMapping: { value: [{ id: "orders.outcome" }] },
          // No widget title (off by default); the "Filter by" line is hidden in dashboard.module.css.
          // Studio leaves unset item colours transparent, so the selected state needs its own fill.
          format: {
            style: {
              dimensions: { height: 32, minWidth: 128 },
              defaultItem: {
                typography: typography(BODY, 15),
                color: INK,
                backgroundColor: CARD,
                textAlign: "center",
                borderEnabled: true,
                borderWidth: 2,
                borderRadius: 10,
                borderColor: INK,
              },
              activeItem: { color: NAVY, backgroundColor: YELLOW },
            },
          },
        },
        orders: { type: "orders-grid", dataMapping: {} },
        "price-history": { type: "price-chart", dataMapping: {} },
        "by-outcome": {
          type: "donut-chart",
          dataMapping: { categoryKey: [{ id: "orders.outcome" }], valueKey: [countd("orders.id")] },
          format: {
            ...title("Orders by outcome"),
            style: { custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } } },
          },
        },
        "saved-by-shop": {
          type: "bar-chart-grouped",
          dataMapping: {
            categoryKey: [{ id: "purchases.shop" }],
            valueKey: [sum("purchases.saved"), sum("purchases.spent")],
          },
          format: {
            ...title("Saved and spent by shop"),
            style: { theme: { common: { legend: { enabled: true } } } },
          },
        },
      },
      widgetLayout: {
        "kpi-held": at(0, 0, 6, 7),
        "kpi-spent": at(6, 0, 6, 7),
        "kpi-saved": at(12, 0, 6, 7),
        "kpi-bought": at(18, 0, 3, 7),
        "kpi-released": at(21, 0, 3, 7),
        // Its own full-width row, so every outcome button has room for its whole label.
        outcome: at(0, 7, 24, 4),
        orders: at(0, 11, 14, 22),
        "price-history": at(14, 11, 10, 22),
        "by-outcome": at(0, 33, 9, 17),
        "saved-by-shop": at(9, 33, 15, 17),
      },
    },
  ],
};
