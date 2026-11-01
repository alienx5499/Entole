import type { MandateView } from "@/shared/api";
import { OUTCOME_LABEL } from "@/shared/ui";
import { HoldGauge } from "./HoldGauge";
import s from "./MandateCard.module.css";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86400000],
  ["hour", 3600000],
  ["minute", 60000],
];

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "always" });

function relative(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const [unit, ms] = UNITS.find(([, m]) => Math.abs(diff) >= m) ?? (["minute", 60000] as const);
  const text = RELATIVE.format(Math.round(diff / ms), unit);
  return diff >= 0 ? `ends ${text}` : `ended ${text}`;
}

function endLine(m: MandateView): string {
  if (m.status === "exhausted") return "Bought, releasing the rest";
  if (m.status !== "closed") return relative(m.validUntil);
  const at = m.audit.findLast((e) => e.kind === "closed")?.at;
  return at
    ? `Closed ${new Date(at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}`
    : "Closed";
}

export function MandateCard({ mandate: m }: { mandate: MandateView }) {
  const t = m.terms;
  const attrs = Object.entries(t.requiredAttributes);
  return (
    <section className={`card ${s.card}`}>
      <h2 className={s.title}>{t.query}</h2>
      <p className={s.line}>
        <span className={`chip ${s.badge}`} aria-live="polite">
          {OUTCOME_LABEL[m.outcome]}
        </span>{" "}
        <span className="mono" title={m.digest}>
          {m.digest.slice(0, 12)}…
        </span>
      </p>
      <p className={`mono ${s.limit}`}>Limit ${t.limitPrice}</p>
      <HoldGauge
        held={m.held}
        captured={m.captured}
        remaining={m.remaining}
        voided={m.voided}
        status={m.status}
      />
      <div className={s.terms}>
        {t.brands.length > 0 && <p>Brands: {t.brands.join(", ")}</p>}
        {t.avoid.length > 0 && <p>Avoid: {t.avoid.join(", ")}</p>}
        {attrs.length > 0 && <p>{attrs.map(([k, v]) => `${k}: ${v}`).join(", ")}</p>}
        <p>
          {endLine(m)} (sandbox)
          {m.authorizationId && (
            <>
              <br />
              <span className="mono">{m.authorizationId}</span>
            </>
          )}
        </p>
      </div>
    </section>
  );
}
