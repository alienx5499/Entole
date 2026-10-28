"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MandateView, PricesResponse } from "@/shared/api";
import { checkNow, getMandate, getPrices } from "@/shared/api";
import { CurveLoader, ScribbleLink } from "@/shared/ui";
import { ActionBar } from "./ActionBar";
import s from "./LiveMandate.module.css";
import { MandateCard } from "./MandateCard";
import { PricePanel } from "./PricePanel";
import { hasReceipt, Receipt } from "./Receipt";
import { ReplayBanner } from "./ReplayBanner";
import { Timeline } from "./Timeline";

// Fast only while a replay moves prices; otherwise the watcher works on a much slower cadence.
const POLL_REPLAY_MS = 2000;
const POLL_MS = 30_000;

function replayRunning(p: PricesResponse | null): boolean {
  if (!p?.replay || !p.startedAt) return false;
  return p.candidates.some((c) => c.currentIndex === null || c.currentIndex < c.points.length - 1);
}

export function LiveMandate({ id }: { id: string }) {
  const q = useSearchParams();
  const [mandate, setMandate] = useState<MandateView | null>(null);
  const [prices, setPrices] = useState<PricesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"timeline" | "receipt">("timeline");

  const running = replayRunning(prices) && mandate?.status === "funded";
  const exhausted = mandate?.status === "exhausted";
  const live =
    mandate?.status === "awaiting_approval" || mandate?.status === "funded" || running || exhausted;

  // The last replay point is often the lowest: check it once before the normal polling takes over.
  const replayDone = !!prices?.replay && !!prices.startedAt && !replayRunning(prices);
  const finalChecked = useRef(false);

  const refreshPrices = useCallback(
    () =>
      getPrices(id)
        .then(setPrices)
        .catch(() => {}),
    [id],
  );

  useEffect(() => {
    getMandate(id)
      .then(setMandate)
      .catch((e: Error) => setLoadError(e.message));
    refreshPrices();
  }, [id, refreshPrices]);

  useEffect(() => {
    if (running) finalChecked.current = false;
    if (!replayDone || mandate?.status !== "funded" || finalChecked.current) return;
    finalChecked.current = true;
    checkNow(id)
      .then((r) => setMandate(r.mandate))
      .then(refreshPrices)
      .catch(() => {
        finalChecked.current = false;
      });
  }, [id, running, replayDone, mandate?.status, refreshPrices]);

  useEffect(() => {
    if (!live) return;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        if (running) {
          setMandate((await checkNow(id)).mandate);
          await refreshPrices();
        } else {
          setMandate(await getMandate(id));
        }
      } catch {
        // next tick retries
      }
    };
    const t = setInterval(tick, running ? POLL_REPLAY_MS : POLL_MS);
    // A hidden tab skips ticks, so catch up the moment it is shown again.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [id, live, running, refreshPrices]);

  if (loadError)
    return (
      <p className="error-note" role="alert">
        Could not load this mandate: {loadError}
      </p>
    );
  if (!mandate) return <CurveLoader title="Loading your mandate" />;

  return (
    <div className={s.page}>
      <ReplayBanner mandate={mandate} />
      {q.get("error") === "funding" && (
        <p className="error-note" role="alert">
          PayPal approval failed, nothing was charged
        </p>
      )}
      {q.get("cancelled") === "1" && <p className="note-blue">You cancelled at PayPal</p>}
      {mandate.status === "awaiting_approval" && (
        <p className="note-blue">
          Not approved yet.{" "}
          <ScribbleLink href={`/mandates/${encodeURIComponent(id)}/review`}>
            Review and approve
          </ScribbleLink>
        </p>
      )}
      <div className={s.grid}>
        <div className={s.left}>
          <MandateCard mandate={mandate} />
        </div>
        <div className={s.centre}>
          {mandate.outcome === "cancelled" ? (
            <section className="card">
              <p>
                You cancelled this limit order before approving it. PayPal never placed a hold, so
                nothing was charged or released.
              </p>
              <Link
                className="btn btn-primary"
                href={`/mandates/new?from=${encodeURIComponent(id)}`}
              >
                Start again with these rules
              </Link>
            </section>
          ) : (
            <>
              <PricePanel mandate={mandate} prices={prices} />
              <ActionBar
                mandate={mandate}
                running={running}
                onMandate={setMandate}
                onReplayStarted={refreshPrices}
              />
            </>
          )}
        </div>
        <div className={s.right}>
          {hasReceipt(mandate) && (
            <div className={s.tabs} role="tablist" aria-label="Order details">
              {(["timeline", "receipt"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  className={`chip ${s.tab}`}
                  onClick={() => setTab(t)}
                >
                  {t === "timeline" ? "Timeline" : "Receipt"}
                </button>
              ))}
            </div>
          )}
          {tab === "receipt" && hasReceipt(mandate) ? (
            <Receipt mandate={mandate} />
          ) : (
            <>
              <Timeline audit={mandate.audit} />
              <p>
                <ScribbleLink href={`/schedule?order=${encodeURIComponent(id)}`}>
                  Open on the schedule
                </ScribbleLink>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
