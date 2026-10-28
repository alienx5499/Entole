import type { MandateView } from "@/shared/api";
import s from "./review.module.css";

const DAY_MS = 86_400_000;

export function TermsSummary({ mandate: m }: { mandate: MandateView }) {
  const t = m.terms;
  const days = Math.max(
    1,
    Math.round((new Date(m.validUntil).getTime() - new Date(m.createdAt).getTime()) / DAY_MS),
  );
  const attrs = Object.entries(t.requiredAttributes);
  const demos = [
    m.demoInjection && "malicious listing added",
    m.replay && "replays real price history",
  ].filter(Boolean);
  return (
    <section className={s.terms} aria-labelledby="terms-title">
      <h2 id="terms-title" className={s.title}>
        Your rules
      </h2>
      <p className={s.item}>{t.query}</p>
      <p>
        <span className="highlight">at or below ${t.limitPrice}</span>, valid {days}{" "}
        {days === 1 ? "day" : "days"}
      </p>
      <dl className={s.rules}>
        {t.brands.length > 0 && (
          <div>
            <dt>Brands</dt>
            <dd>{t.brands.join(", ")}</dd>
          </div>
        )}
        {t.avoid.length > 0 && (
          <div>
            <dt>Avoid</dt>
            <dd>{t.avoid.join(", ")}</dd>
          </div>
        )}
        {attrs.length > 0 && (
          <div>
            <dt>Must have</dt>
            <dd>{attrs.map(([k, v]) => `${k}: ${v}`).join(", ")}</dd>
          </div>
        )}
        {demos.length > 0 && (
          <div>
            <dt>Demo</dt>
            <dd>{demos.join(", ")}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
