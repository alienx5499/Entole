// The sketch theme: the app's ink, paper and fonts applied to Studio, its grids and charts.

import { studioTheme } from "ag-studio";

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
export const HEADING = 'var(--font-heading), "Comic Sans MS", cursive';
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
