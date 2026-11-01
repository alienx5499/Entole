import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import type { MandateView, PriceSeries, RejectedView, Taste } from "@/shared/api";
import { ApiError, createMandate, getPrices } from "@/shared/api";
import { MAX_ATTRS, type Row } from "./AttributeRows";
import { daysBetween, MAX_LIMIT_USD, MIN_LIMIT_USD } from "./limits";

const toRows = (t: Taste | null): Row[] => {
  const rows = Object.entries(t?.attributes ?? {}).map(([key, value]) => ({ key, value }));
  return rows.length ? rows.slice(0, MAX_ATTRS) : [{ key: "Size", value: "10" }];
};
const toList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

type FormError = { field?: string; message: string };

const isNoMatch = (err: unknown): err is ApiError =>
  err instanceof ApiError && err.status === 422 && err.error === "no_candidates";

function toFormError(err: unknown): FormError {
  if (isNoMatch(err)) return { message: "No item matched. Try a higher price or fewer rules." };
  if (err instanceof ApiError) {
    return { field: err.field, message: err.field ? `${err.field}: ${err.error}` : err.error };
  }
  return { message: "Something went wrong. Try again." };
}

/** The form's state, the edited order's price history, and the submit that creates the order. */
export function useMandateForm(taste: Taste | null, previous: MandateView | null) {
  const router = useRouter();
  const was = previous?.terms;
  const [query, setQuery] = useState(was?.query ?? "");
  const [brands, setBrands] = useState(() => (was?.brands ?? taste?.brands ?? []).join(", "));
  const [avoid, setAvoid] = useState(() => (was?.avoid ?? taste?.avoid ?? []).join(", "));
  const [rows, setRows] = useState<Row[]>(() =>
    was ? toRows({ brands: [], avoid: [], attributes: was.requiredAttributes }) : toRows(taste),
  );
  const [price, setPrice] = useState(was?.limitPrice ?? "");
  const [days, setDays] = useState(() => (previous ? daysBetween(previous) : 3));
  const [trap, setTrap] = useState(previous?.demoInjection ?? true);
  const [replay, setReplay] = useState(previous?.replay ?? true);
  const [loading, setLoading] = useState(false);
  const [rejected, setRejected] = useState<RejectedView[]>([]);
  const [error, setError] = useState<FormError | null>(null);
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
      if (isNoMatch(err)) setRejected(err.rejected ?? []);
      setError(toFormError(err));
    }
  };

  return {
    query,
    setQuery,
    brands,
    setBrands,
    avoid,
    setAvoid,
    rows,
    setRows,
    price,
    setPrice,
    days,
    setDays,
    trap,
    setTrap,
    replay,
    setReplay,
    loading,
    rejected,
    error,
    series,
    onTaste,
    submit,
  };
}
