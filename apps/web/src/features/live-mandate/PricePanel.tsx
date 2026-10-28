import type { MandateView, PricesResponse } from "@/shared/api";
import { PriceChart } from "./PriceChart";
import s from "./PricePanel.module.css";
import { SavingsBadge } from "./SavingsBadge";
import { WhyThisOne } from "./WhyThisOne";

type Props = { mandate: MandateView; prices: PricesResponse | null };

// The watcher buys from the cheapest signed shop that passes every check when the price drops.
const shopLine = (c: MandateView["candidates"][number]): string =>
  c.shops.length > 1
    ? `from ${c.merchant} now, or the cheapest of ${c.shops.length} shops (${c.shops.join(", ")})`
    : `from ${c.merchant}`;

/** One chart per signed item; after a capture the savings and the reasons take its place. */
export function PricePanel({ mandate, prices }: Props) {
  if (mandate.purchase)
    return (
      <div className={s.panel}>
        <SavingsBadge purchase={mandate.purchase} />
        <WhyThisOne purchase={mandate.purchase} />
      </div>
    );
  return (
    <section className={s.panel} aria-label="Prices">
      {mandate.candidates.map((c) => {
        const series = prices?.candidates.find((p) => p.productId === c.productId);
        return series && series.points.length > 0 ? (
          <div key={c.productId}>
            <PriceChart series={series} priceNow={c.baselinePrice} />
            <p className={s.shops} title={shopLine(c)}>
              {shopLine(c)}
            </p>
          </div>
        ) : (
          <p key={c.productId} className={s.row}>
            <span>
              {c.title} <span className={s.soft}>{shopLine(c)}</span>
            </span>
            <span className="mono">Price now ${c.baselinePrice}</span>
            <span className={s.note}>No price history from Channel3 yet, so no chart.</span>
          </p>
        );
      })}
    </section>
  );
}
