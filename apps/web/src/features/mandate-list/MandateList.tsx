"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MandateSummary } from "@/shared/api";
import { closeMandate, listMandates } from "@/shared/api";
import { CurveLoader, OUTCOME_LABEL } from "@/shared/ui";
import s from "./mandate-list.module.css";
import { RowMenu } from "./RowMenu";

const href = (m: MandateSummary) =>
  m.status === "awaiting_approval"
    ? `/mandates/${encodeURIComponent(m.id)}/review`
    : `/mandates/${encodeURIComponent(m.id)}`;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Every limit order the signed-in user has made, newest first. */
export function MandateList() {
  const [rows, setRows] = useState<MandateSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  // Cancelling an unapproved order closes it; no PayPal hold exists yet, so nothing is released.
  const cancel = async (id: string) => {
    setCancelling(id);
    try {
      await closeMandate(id);
      setRows(await listMandates());
    } finally {
      setCancelling(null);
    }
  };

  // A 401 sends the browser to `/?login=1` inside the client.
  useEffect(() => {
    listMandates()
      .then(setRows)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p role="alert">Could not load your limit orders. Reload to retry.</p>;
  if (!rows) return <CurveLoader title="Loading your limit orders" />;

  return (
    <section className={s.wrap} aria-labelledby="orders-title">
      <div className={s.head}>
        <h1 id="orders-title">Your limit orders</h1>
        <Link className="btn btn-primary" href="/mandates/new">
          New limit order
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="card">No limit orders yet. Set a price and Entole will watch it for you.</p>
      ) : (
        <ul className={s.list}>
          {rows.map((m) => (
            <li key={m.id} className={s.item}>
              <Link className={`card ${s.row}`} href={href(m)}>
                <span className={s.query}>{m.query}</span>
                <span className={s.meta}>
                  limit ${m.limitPrice}
                  {m.captured !== "0.00" && ` · paid $${m.captured}`} · {day(m.createdAt)}
                </span>
                <span className={`${s.status} ${s[m.outcome]}`}>{OUTCOME_LABEL[m.outcome]}</span>
              </Link>
              {m.outcome === "needs_approval" && (
                <RowMenu label={m.query} busy={cancelling === m.id} onCancel={() => cancel(m.id)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
