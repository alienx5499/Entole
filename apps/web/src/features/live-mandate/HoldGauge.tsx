import s from "./HoldGauge.module.css";

type Props = { held: string; captured: string; remaining: string; voided: boolean; status: string };

const TICKS = 48;
const C = 110;
const R_IN = 78;
const R_OUT = 100;
const R_MID = 89;
const STAGGER_MS = 12;

function cents(v: string): number {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

function point(angle: number, r: number): [number, number] {
  return [C + r * Math.cos(angle), C - r * Math.sin(angle)];
}

type Kind = "captured" | "remaining" | "released" | "empty";

function tickKinds(held: number, captured: number, released: boolean): Kind[] {
  if (held <= 0) return Array.from({ length: TICKS }, () => "empty");
  const cap = Math.min(TICKS, Math.round((Math.min(captured, held) / held) * TICKS));
  return Array.from({ length: TICKS }, (_, i) =>
    i < cap ? "captured" : released ? "released" : "remaining",
  );
}

function caption(held: number, captured: number, remaining: number, released: boolean): string {
  if (held <= 0) return "awaiting approval";
  // After a buy the centre shows what was paid; the ring shows the rest coming back.
  if (released) return captured > 0 ? "paid, rest released" : "released";
  return remaining <= 0 && captured > 0 ? "captured" : "held";
}

export function HoldGauge({ held, captured, remaining, voided, status }: Props) {
  const h = cents(held);
  const c = cents(captured);
  const r = cents(remaining);
  const released = h > 0 && (voided || status === "closed");
  const kinds = tickKinds(h, c, released);
  const label = caption(h, c, r, released);
  const firstReleased = kinds.indexOf("released");
  const strike =
    firstReleased >= 0
      ? (() => {
          const a0 = Math.PI - (firstReleased / TICKS) * Math.PI;
          const [x0, y0] = point(a0, R_MID);
          const [x1, y1] = point(0, R_MID);
          return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${R_MID} ${R_MID} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
        })()
      : null;
  const summary = `Hold of $${held}: $${captured} captured, $${released ? remaining : "0.00"} released, $${released ? "0.00" : remaining} still held. Status ${status.replace("_", " ")}.`;
  const key = `${kinds.join("")}`;

  return (
    <figure className={s.wrap}>
      <svg
        className={s.svg}
        viewBox="0 0 220 120"
        role="img"
        aria-label={h > 0 ? summary : "Hold awaiting approval, nothing held yet."}
      >
        <g key={key}>
          {kinds.map((kind, i) => {
            const a = Math.PI - ((i + 0.5) / TICKS) * Math.PI;
            const [x1, y1] = point(a, R_IN);
            const [x2, y2] = point(a, R_OUT);
            return (
              <line
                // biome-ignore lint/suspicious/noArrayIndexKey: ticks are positional and fixed
                key={i}
                className={`${s.tick} ${s[kind]}`}
                x1={x1.toFixed(1)}
                y1={y1.toFixed(1)}
                x2={x2.toFixed(1)}
                y2={y2.toFixed(1)}
                style={{ animationDelay: `${i * STAGGER_MS}ms` }}
              />
            );
          })}
        </g>
        {strike && <path d={strike} className={s.strike} />}
        <text x={C} y={92} textAnchor="middle" className={s.amount}>
          ${released && c > 0 ? captured : held}
        </text>
        <text x={C} y={112} textAnchor="middle" className={s.caption}>
          {label}
        </text>
      </svg>
      <dl className={s.legend}>
        <div>
          <dt>Captured</dt>
          <dd className="mono">${captured}</dd>
        </div>
        <div>
          <dt>Released</dt>
          <dd className="mono">${released ? remaining : "0.00"}</dd>
        </div>
        <div>
          <dt>Still held</dt>
          <dd className="mono">${released ? "0.00" : remaining}</dd>
        </div>
      </dl>
    </figure>
  );
}
