import type { PriceSeries } from "@/shared/api";
import styles from "./MandateForm.module.css";

type Props = { series: PriceSeries[]; onUse: (price: string) => void };

const vsLow = (pct: number | null) =>
  pct === null ? "" : pct === 0 ? ", at its 30-day low" : `, ${pct}% above its 30-day low`;

/** Channel3 price history of the items this order signed, with the lowest low as a one-click limit. */
export function PriceStats({ series, onUse }: Props) {
  const rows = series.flatMap((c) => (c.stats ? [{ ...c, stats: c.stats }] : []));
  const best = rows.reduce<(typeof rows)[number] | undefined>(
    (a, b) => (a && Number(a.stats.low) <= Number(b.stats.low) ? a : b),
    undefined,
  );
  if (!best) return null;
  return (
    <div className={styles.stats}>
      {rows.map((c) => (
        <p key={c.productId} className={styles.hint}>
          <strong>{c.title}</strong>: 30-day low ${c.stats.low}, high ${c.stats.high}. Now $
          {c.stats.current}
          {vsLow(c.stats.aboveLowPercent)}.
        </p>
      ))}
      <button type="button" className="btn btn-ghost" onClick={() => onUse(best.stats.low)}>
        Use 30-day low of {best.title} (${best.stats.low})
      </button>
    </div>
  );
}
