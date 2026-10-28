import type { PriceSeries } from "@/shared/api";
import s from "./PriceChart.module.css";

const W = 600;
const H = 120;
const PAD = 14;

type Props = { series: PriceSeries; priceNow?: string };

export function PriceChart({ series, priceNow }: Props) {
  const prices = series.points.map((p) => Number(p.price));
  const limit = Number(series.limit);
  const lo = Math.min(...prices, limit);
  const hi = Math.max(...prices, limit);
  const span = hi - lo || 1;
  const n = Math.max(prices.length - 1, 1);
  const x = (i: number) => PAD + (i / n) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - 2 * PAD);
  const line = prices.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const cur = series.currentIndex;
  const label = `Price history for ${series.title}, ${prices.length} points, from $${lo.toFixed(2)} to $${hi.toFixed(2)}, your price $${limit.toFixed(2)}${series.current ? `, now $${series.current}` : ""}`;
  return (
    <figure className={s.figure}>
      <figcaption className={s.caption}>
        <span>{series.title}</span>
        {priceNow && <span className="mono">Price now ${priceNow}</span>}
      </figcaption>
      <svg
        className={s.svg}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        <line x1={0} x2={W} y1={y(limit)} y2={y(limit)} stroke="var(--red)" strokeDasharray="6 4" />
        <polyline points={line} fill="none" stroke="var(--blue)" strokeWidth={2} />
        {cur !== null && prices[cur] !== undefined && (
          <circle cx={x(cur)} cy={y(prices[cur])} r={5} fill="var(--ink)" />
        )}
        <text x={W - PAD} y={y(limit) - 4} textAnchor="end" fontSize={12} fill="var(--red)">
          your price ${limit.toFixed(2)}
        </text>
        <text x={PAD} y={12} fontSize={11} fill="var(--ink-soft)">
          max ${hi.toFixed(2)}
        </text>
        <text x={PAD} y={H - 2} fontSize={11} fill="var(--ink-soft)">
          min ${lo.toFixed(2)}
        </text>
      </svg>
    </figure>
  );
}
