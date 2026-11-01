"use client";

import { useState } from "react";
import type { MandateView, VerdictView } from "@/shared/api";
import { checkNow, closeMandate, refundMandate, simulate, startReplay } from "@/shared/api";
import s from "./ActionBar.module.css";

/** Runs one action with the bar's busy flag and error note. */
export type Run = (fn: () => Promise<void>) => Promise<void>;

type Base = { mandate: MandateView; busy: boolean; run: Run };

export function RefundControls({
  mandate,
  busy,
  run,
  onMandate,
  refunding,
  onRefunding,
}: Base & {
  onMandate: (m: MandateView) => void;
  refunding: boolean;
  onRefunding: (on: boolean) => void;
}) {
  if (mandate.outcome === "refunded") {
    return <p className={s.confirm}>Refunded in full (sandbox).</p>;
  }
  if (!refunding) {
    return (
      <button type="button" className="btn btn-secondary" onClick={() => onRefunding(true)}>
        Refund (sandbox)
      </button>
    );
  }
  return (
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
            onRefunding(false);
          })
        }
      >
        Yes, refund
      </button>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy}
        onClick={() => onRefunding(false)}
      >
        Keep it
      </button>
    </>
  );
}

/** The buttons a funded order offers; rendered only while it is funded. */
export function FundedActions({
  mandate,
  busy,
  run,
  running,
  onMandate,
  onReplayStarted,
  onVerdict,
}: Base & {
  running: boolean;
  onMandate: (m: MandateView) => void;
  onReplayStarted: () => void;
  onVerdict: (v: VerdictView) => void;
}) {
  return (
    <>
      {mandate.replay && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || running}
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
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy}
        onClick={() => run(async () => onMandate((await checkNow(mandate.id)).mandate))}
      >
        Check price now
      </button>
      {mandate.demoInjection && (
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy}
          onClick={() => run(async () => onVerdict((await simulate(mandate.id)).verdict))}
        >
          Simulate compromised agent
          <span className="btn-tag">demo</span>
        </button>
      )}
    </>
  );
}

export function CloseControls({
  mandate,
  busy,
  run,
  onMandate,
}: Base & { onMandate: (m: MandateView) => void }) {
  const [confirming, setConfirming] = useState(false);
  const canClose = mandate.status === "funded" || mandate.status === "exhausted";

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn btn-danger"
        disabled={busy || !canClose}
        onClick={() => setConfirming(true)}
      >
        Close and release hold
      </button>
    );
  }
  return (
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
  );
}

export function VerdictNote({ verdict }: { verdict: VerdictView }) {
  const blocked = verdict.kind === "block";
  return (
    <div aria-live="polite">
      <strong className={blocked ? "pen-strike" : "highlight"}>
        Simulation: {blocked ? "blocked" : "allowed"}
      </strong>
      {blocked && (
        <ul>
          {verdict.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
