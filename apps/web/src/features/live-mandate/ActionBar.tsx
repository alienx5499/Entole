"use client";

import Link from "next/link";
import { useState } from "react";
import type { MandateView, VerdictView } from "@/shared/api";
import { checkNow, closeMandate, refundMandate, simulate, startReplay } from "@/shared/api";
import s from "./ActionBar.module.css";

type Props = {
  mandate: MandateView;
  running: boolean;
  onMandate: (m: MandateView) => void;
  onReplayStarted: () => void;
};

export function ActionBar({ mandate, running, onMandate, onReplayStarted }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [verdict, setVerdict] = useState<VerdictView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const funded = mandate.status === "funded";
  const off = busy || !funded;
  const canClose = funded || mandate.status === "exhausted";

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

  const canRefund = mandate.outcome === "bought";
  // The refund controls, placed inside a button row by the caller.
  const refundControls =
    (canRefund || mandate.outcome === "refunded") &&
    (mandate.outcome === "refunded" ? (
      <p className={s.confirm}>Refunded in full (sandbox).</p>
    ) : refunding ? (
      <>
        <span className={s.confirm}>
          Refund ${mandate.captured} to your PayPal account? Sandbox only.
        </span>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy}
          onClick={() =>
            run(async () => {
              onMandate(await refundMandate(mandate.id));
              setRefunding(false);
            })
          }
        >
          Yes, refund
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => setRefunding(false)}
        >
          Keep it
        </button>
      </>
    ) : (
      <button type="button" className="btn btn-secondary" onClick={() => setRefunding(true)}>
        Refund (sandbox)
      </button>
    ));
  const errorNote = error && (
    <p className="error-note" role="alert">
      {error}
    </p>
  );

  if (mandate.status === "closed") {
    const released = (
      (Math.round(Number(mandate.held) * 100) - Math.round(Number(mandate.captured) * 100)) /
      100
    ).toFixed(2);
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
        {funded && mandate.replay && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={off || running}
            onClick={() =>
              run(async () => {
                await startReplay(mandate.id);
                onReplayStarted();
              })
            }
          >
            Start replay
          </button>
        )}
        {funded && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={off}
            onClick={() => run(async () => onMandate((await checkNow(mandate.id)).mandate))}
          >
            Check price now
          </button>
        )}
        {funded && mandate.demoInjection && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={off}
            onClick={() => run(async () => setVerdict((await simulate(mandate.id)).verdict))}
          >
            Simulate compromised agent
            <span className="btn-tag">demo</span>
          </button>
        )}
        {confirming ? (
          <>
            <span className={s.confirm}>Release the hold? Nothing more will be bought.</span>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || !canClose}
              onClick={() =>
                run(async () => {
                  onMandate(await closeMandate(mandate.id));
                  setConfirming(false);
                })
              }
            >
              Yes, close
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || !canClose}
            onClick={() => setConfirming(true)}
          >
            Close and release hold
          </button>
        )}
      </div>
      {refundControls && <div className={s.row}>{refundControls}</div>}
      {errorNote}
      {verdict && (
        <div aria-live="polite">
          <strong className={verdict.kind === "block" ? "pen-strike" : "highlight"}>
            Simulation: {verdict.kind === "block" ? "blocked" : "allowed"}
          </strong>
          {verdict.kind === "block" && (
            <ul>
              {verdict.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
