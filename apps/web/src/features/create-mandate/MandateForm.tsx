"use client";

import type { MandateView, Taste } from "@/shared/api";
import { CurveSpinner, RejectedList } from "@/shared/ui";
import { AttributeRows } from "./AttributeRows";
import { MAX_VALID_DAYS } from "./limits";
import styles from "./MandateForm.module.css";
import { PriceStats } from "./PriceStats";
import { TasteChips } from "./TasteChips";
import { useMandateForm } from "./useMandateForm";

/** The mandate being edited ("Change my rules"); its rules fill the form. */
type Props = { taste: Taste | null; previous?: MandateView | null };

// An edited order's own window stays selectable even when it is not a preset.
const dayChoices = (days: number) =>
  [...new Set([1, 2, 3, 7, 14, MAX_VALID_DAYS, days])].sort((a, b) => a - b);

export function MandateForm({ taste, previous = null }: Props) {
  const f = useMandateForm(taste, previous);

  return (
    <form className={styles.card} onSubmit={f.submit}>
      {/* Disabled while the agent shortlists, so the rules cannot change mid-search. */}
      <fieldset className={styles.fields} disabled={f.loading}>
        <div className={styles.taste}>
          <h2 className={styles.small}>Your taste</h2>
          <TasteChips taste={taste} onChange={f.onTaste} />
        </div>
        <div className={styles.cols}>
          <div className={styles.col}>
            <label>
              What to buy
              <input
                required
                placeholder="trail running shoes"
                value={f.query}
                onChange={(e) => f.setQuery(e.target.value)}
              />
            </label>
            <div className={styles.pair}>
              <label>
                Brands (comma list)
                <input value={f.brands} onChange={(e) => f.setBrands(e.target.value)} />
              </label>
              <label>
                Avoid (comma list)
                <input value={f.avoid} onChange={(e) => f.setAvoid(e.target.value)} />
              </label>
            </div>
            <AttributeRows rows={f.rows} onChange={f.setRows} />
          </div>
          <div className={`${styles.col} ${styles.side}`}>
            <div className={styles.pair}>
              <label>
                Max price (USD, sandbox)
                <input
                  required
                  inputMode="decimal"
                  aria-invalid={f.error?.field === "limitPrice"}
                  aria-describedby={f.error ? "form-error" : undefined}
                  placeholder="1.00 to 5000.00"
                  value={f.price}
                  onChange={(e) => f.setPrice(e.target.value)}
                />
              </label>
              <label>
                Valid days
                <select value={f.days} onChange={(e) => f.setDays(Number(e.target.value))}>
                  {dayChoices(f.days).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <PriceStats series={f.series} onUse={f.setPrice} />
            <p className={styles.hint}>
              The agent buys one of your items only if its price drops to this or lower.
            </p>
            <p className={styles.hint}>
              Tip for the demo: pick a price below today's price so you can watch it wait.
            </p>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={f.trap}
                onChange={(e) => f.setTrap(e.target.checked)}
              />
              Add a malicious listing (demo)
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={f.replay}
                onChange={(e) => f.setReplay(e.target.checked)}
              />
              Replay real price history (demo)
            </label>
          </div>
        </div>
        <div className={styles.footer}>
          <div aria-live="polite" className={styles.feedback}>
            {f.error && (
              <p id="form-error" className={styles.error} role="alert">
                {f.error.message}
              </p>
            )}
            {f.rejected.length > 0 && <RejectedList rejected={f.rejected} />}
          </div>
          <button
            className={`btn btn-primary ${styles.submit}`}
            type="submit"
            disabled={f.loading}
            aria-busy={f.loading || undefined}
          >
            {f.loading && <CurveSpinner />}
            {f.loading ? "Agent is shortlisting…" : "Find items"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
