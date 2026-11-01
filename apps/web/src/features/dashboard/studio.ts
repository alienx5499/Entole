// AG Studio setup for the dashboard: the custom widgets, the tables, the sketch theme and the
// report it opens on, each in its own module.

export { buildData } from "./studio-data";
export { initialReport } from "./studio-report";
export { CHART_COLORS, SKETCH, sketchTheme } from "./studio-theme";
export {
  ENTOLE_MENU,
  type EntoleRegistry,
  entoleFormatShape,
  type OrdersGridDef,
  ordersGridWidget,
  type PriceChartDef,
  priceChartWidget,
} from "./studio-widgets";
