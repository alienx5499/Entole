import { getPrices, listMandateViews } from "@/shared/api";
import { mapLimit, type OrderRow, type PriceRow, toOrderRow, toPriceRows } from "./dashboard-data";

// Every order comes in one call; price histories are per order, a few at a time to stay well under
// Channel3's rate limit.
const IN_FLIGHT = 3;

export type DashboardData = { orders: OrderRow[]; prices: PriceRow[] };

export async function loadDashboard(): Promise<DashboardData> {
  const views = await listMandateViews();
  const prices = await mapLimit(views, IN_FLIGHT, ({ id }) =>
    // An order with no price history still shows in the grid, just with no chart.
    getPrices(id)
      .then((p) => toPriceRows(id, p))
      .catch(() => []),
  );
  return { orders: views.map(toOrderRow), prices: prices.flat() };
}
