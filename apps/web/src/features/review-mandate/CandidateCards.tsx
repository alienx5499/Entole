import type { CandidateView } from "@/shared/api";
import s from "./review.module.css";

export function CandidateCards({ candidates }: { candidates: CandidateView[] }) {
  return (
    <ul className={s.cards}>
      {candidates.map((c) => {
        const opts = Object.entries(c.options);
        return (
          <li key={`${c.productId}-${c.merchant}`} className={s.candidate}>
            <strong className={s.candTitle}>{c.title}</strong>
            <span className={s.soft}>
              {c.shops.length > 1
                ? `${c.shops.length} shops compared: ${c.shops.join(", ")}`
                : c.merchant}
            </span>
            <span className="mono">Price now ${c.baselinePrice}</span>
            {opts.length > 0 && (
              <span className={s.soft}>{opts.map(([k, v]) => `${k}: ${v}`).join(", ")}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
