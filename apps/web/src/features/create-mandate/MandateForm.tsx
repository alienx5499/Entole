"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import type { MandateView, PriceSeries, RejectedView, Taste } from "@/shared/api";
import { ApiError, createMandate, getPrices } from "@/shared/api";
import { CurveSpinner, RejectedList } from "@/shared/ui";
import { AttributeRows, MAX_ATTRS, type Row } from "./AttributeRows";
import { daysBetween, MAX_LIMIT_USD, MAX_VALID_DAYS, MIN_LIMIT_USD } from "./limits";
import styles from "./MandateForm.module.css";
import { PriceStats } from "./PriceStats";
import { TasteChips } from "./TasteChips";

/** The mandate being edited ("Change my rules"); its rules fill the form. */
type Props = { taste: Taste | null; previous?: MandateView | null };

const toRows = (t: Taste | null): Row[] => {
  const rows = Object.entries(t?.attributes ?? {}).map(([key, value]) => ({ key, value }));
  return rows.length ? rows.slice(0, MAX_ATTRS) : [{ key: "Size", value: "10" }];
};
// An edited order's own window stays selectable even when it is not a preset.
const dayChoices = (days: number) =>
  [...new Set([1, 2, 3, 7, 14, MAX_VALID_DAYS, days])].sort((a, b) => a - b);
const toList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function MandateForm({ taste, previous = null }: Props) {
  const router = useRouter();
  const was = previous?.terms;
  const [query, setQuery] = useState(was?.query ?? "");
  const [brands, setBrands] = useState((was?.brands ?? taste?.brands ?? []).join(", "));
  const [avoid, setAvoid] = useState((was?.avoid ?? taste?.avoid ?? []).join(", "));
  const [rows, setRows] = useState<Row[]>(() =>
    was ? toRows({ brands: [], avoid: [], attributes: was.requiredAttributes }) : toRows(taste),
  );
  const [price, setPrice] = useState(was?.limitPrice ?? "");
  const [days, setDays] = useState(() => (previous ? daysBetween(previous) : 3));
  const [trap, setTrap] = useState(previous?.demoInjection ?? true);
  const [replay, setReplay] = useState(previous?.replay ?? true);
  const [loading, setLoading] = useState(false);
  const [rejected, setRejected] = useState<RejectedView[]>([]);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [series, setSeries] = useState<PriceSeries[]>([]);

  // Only an edited order has signed items, so only then is there price history to show.
  // The API serves the history it already fetched for that order; no stats is not an error.
  useEffect(() => {
    setSeries([]);
    if (!previous) return;
    let live = true;
    getPrices(previous.id)
      .then((p) => live && setSeries(p.candidates))
      .catch(() => live && setSeries([]));
    return () => {
      live = false;
    };
  }, [previous]);

  const onTaste = (t: Taste) => {
    setBrands(t.brands.join(", "));
    setAvoid(t.avoid.join(", "));
    setRows(Object.entries(t.attributes).map(([key, value]) => ({ key, value })));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(price);
    if (!/^\d+(\.\d{1,2})?$/.test(price) || n < MIN_LIMIT_USD || n > MAX_LIMIT_USD) {
      setError({ field: "limitPrice", message: "Max price must be between 1.00 and 5,000.00" });
      return;
    }
    setError(null);
    setRejected([]);
    setLoading(true);
    try {
      const created = await createMandate({
        query: query.trim(),
        brands: toList(brands),
        avoid: toList(avoid),
        requiredAttributes: Object.fromEntries(
          rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value.trim()]),
        ),
        limitPrice: n.toFixed(2),
        validDays: days,
        demoInjection: trap,
        replay,
      });
      // The button keeps spinning until the review screen takes over.
      router.push(`/mandates/${encodeURIComponent(created.id)}/review`);
    } catch (err) {
      setLoading(false);
      if (err instanceof ApiError && err.status === 401) {
        // The session ran out while the form was open: log in again instead of showing "unauthorized".
        window.location.href = "/api/auth/paypal/start";
        return;
      }
      if (err instanceof ApiError && err.status === 422 && err.error === "no_candidates") {
        setRejected(err.rejected ?? []);
        setError({ message: "No item matched. Try a higher price or fewer rules." });
      } else if (err instanceof ApiError) {
        setError({
          field: err.field,
          message: err.field ? `${err.field}: ${err.error}` : err.error,
        });
      } else {
        setError({ message: "Something went wrong. Try again." });
      }
    }
  };

  return (
    <form className={styles.card} onSubmit={submit}>
      {/* Disabled while the agent shortlists, so the rules cannot change mid-search. */}
      <fieldset className={styles.fields} disabled={loading}>
        <div className={styles.taste}>
          <h2 className={styles.small}>Your taste</h2>
          <TasteChips taste={taste} onChange={onTaste} />
        </div>
        <div className={styles.cols}>
          <div className={styles.col}>
            <label>
              What to buy
              <input
                required
                placeholder="trail running shoes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className={styles.pair}>
              <label>
                Brands (comma list)
                <input value={brands} onChange={(e) => setBrands(e.target.value)} />
              </label>
              <label>
                Avoid (comma list)
                <input value={avoid} onChange={(e) => setAvoid(e.target.value)} />
              </label>
            </div>
            <AttributeRows rows={rows} onChange={setRows} />
          </div>
          <div className={`${styles.col} ${styles.side}`}>
            <div className={styles.pair}>
              <label>
                Max price (USD, sandbox)
                <input
                  required
                  inputMode="decimal"
                  aria-invalid={error?.field === "limitPrice"}
                  aria-describedby={error ? "form-error" : undefined}
                  placeholder="1.00 to 5000.00"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
              <label>
                Valid days
                <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {dayChoices(days).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <PriceStats series={series} onUse={setPrice} />
            <p className={styles.hint}>
              The agent buys one of your items only if its price drops to this or lower.
            </p>
            <p className={styles.hint}>
              Tip for the demo: pick a price below today's price so you can watch it wait.
            </p>
            <label className={styles.check}>
              <input type="checkbox" checked={trap} onChange={(e) => setTrap(e.target.checked)} />
              Add a malicious listing (demo)
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={replay}
                onChange={(e) => setReplay(e.target.checked)}
              />
              Replay real price history (demo)
            </label>
          </div>
        </div>
        <div className={styles.footer}>
          <div aria-live="polite" className={styles.feedback}>
            {error && (
              <p id="form-error" className={styles.error} role="alert">
                {error.message}
              </p>
            )}
            {rejected.length > 0 && <RejectedList rejected={rejected} />}
          </div>
          <button
            className={`btn btn-primary ${styles.submit}`}
            type="submit"
            disabled={loading}
            aria-busy={loading || undefined}
          >
            {loading && <CurveSpinner />}
            {loading ? "Agent is shortlisting…" : "Find items"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
