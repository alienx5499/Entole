import s from "./Stepper.module.css";

const STEPS = ["Set your price", "Review and approve", "Watch the price"] as const;

/** The three-screen limit-order flow; `current` is 1, 2 or 3. */
export function Stepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <nav aria-label="Progress">
      <ol className={s.steps}>
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < current ? "done" : n === current ? "current" : "todo";
          return (
            <li
              key={label}
              className={`${s.step} ${s[state]}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className={s.num} aria-hidden="true">
                {state === "done" ? "✓" : n}
              </span>
              <span className={s.label}>
                {label}
                {state === "done" && <span className={s.srOnly}> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
