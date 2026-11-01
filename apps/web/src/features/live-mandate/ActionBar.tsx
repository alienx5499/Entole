"use client";

import Link from "next/link";
import { useState } from "react";
import type { MandateView, VerdictView } from "@/shared/api";
import s from "./ActionBar.module.css";
import { CloseControls, FundedActions, RefundControls, VerdictNote } from "./ActionControls";

type Props = {
  mandate: MandateView;
  running: boolean;
  onMandate: (m: MandateView) => void;
  onReplayStarted: () => void;
};

export function ActionBar({ mandate, running, onMandate, onReplayStarted }: Props) {
  const [busy, setBusy] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [verdict, setVerdict] = useState<VerdictView | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const actions = { mandate, busy, run, onMandate };
  // The refund controls, placed inside a button row by the caller.
  const refundControls = (mandate.outcome === "bought" || mandate.outcome === "refunded") && (
    <RefundControls {...actions} refunding={refunding} onRefunding={setRefunding} />
  );
  const errorNote = error && (
    <p className="error-note" role="alert">
      {error}
    </p>
  );

  if (mandate.status === "closed") {
    const { released } = mandate.receipt.amounts;
    return (
      <section className="card">
        <p>
          This limit order is closed. ${mandate.captured} captured, ${released} released.
        </p>
        <div className={s.row}>
          {refundControls}
          <Link className="btn btn-primary" href="/mandates/new">
            Start a new limit order
          </Link>
        </div>
        {errorNote}
      </section>
    );
  }

  return (
    <section className="card">
      <div className={s.row}>
        {mandate.status === "funded" && (
          <FundedActions
            {...actions}
            running={running}
            onReplayStarted={onReplayStarted}
            onVerdict={setVerdict}
          />
        )}
        <CloseControls {...actions} />
      </div>
      {refundControls && <div className={s.row}>{refundControls}</div>}
      {errorNote}
      {verdict && <VerdictNote verdict={verdict} />}
    </section>
  );
}
