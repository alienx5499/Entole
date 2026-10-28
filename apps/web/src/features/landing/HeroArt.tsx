import s from "./landing.module.css";

// A stepped price line that falls through the dashed limit; the yellow dot marks the buy.
const PRICE_STEPS = "M24 52 H84 V78 H140 V64 H196 V118 H252 V150 H286 V196 H380";
const LIMIT_Y = 172;
const CROSS_X = 286;

export function HeroArt() {
  return (
    <svg
      className={s.heroArt}
      viewBox="0 0 400 240"
      role="img"
      aria-label="A price line steps down over time and crosses the dashed line for your price"
    >
      <path
        d="M20 22 V214 H388"
        fill="none"
        stroke="var(--ink-soft)"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <line
        x1={20}
        y1={LIMIT_Y}
        x2={388}
        y2={LIMIT_Y}
        stroke="var(--blue)"
        strokeWidth={2.5}
        strokeDasharray="10 8"
        strokeLinecap="round"
      />
      <text
        x={30}
        y={LIMIT_Y - 10}
        fill="var(--blue)"
        fontSize={18}
        fontFamily="var(--font-body), cursive"
      >
        your price
      </text>
      <path
        d={PRICE_STEPS}
        fill="none"
        stroke="var(--ink)"
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={CROSS_X}
        cy={LIMIT_Y}
        r={11}
        fill="var(--yellow)"
        stroke="var(--ink)"
        strokeWidth={2.5}
      />
    </svg>
  );
}
