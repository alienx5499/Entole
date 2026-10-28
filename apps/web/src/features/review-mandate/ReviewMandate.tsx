"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { MandateView } from "@/shared/api";
import { getMandate } from "@/shared/api";
import { CurveLoader } from "@/shared/ui";
import { ApproveBar } from "./ApproveBar";
import { CandidateCards } from "./CandidateCards";
import { RejectedSummary } from "./RejectedSummary";
import s from "./review.module.css";
import { TermsSummary } from "./TermsSummary";

export function ReviewMandate({ id }: { id: string }) {
  const router = useRouter();
  const q = useSearchParams();
  const [mandate, setMandate] = useState<MandateView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const live = `/mandates/${encodeURIComponent(id)}`;

  useEffect(() => {
    getMandate(id)
      .then(setMandate)
      .catch((e: Error) => setLoadError(e.message));
  }, [id]);

  // Approved already (or closed): there is nothing left to review.
  const reviewed = mandate !== null && mandate.status !== "awaiting_approval";
  useEffect(() => {
    if (reviewed) router.replace(live);
  }, [reviewed, router, live]);

  if (loadError)
    return (
      <p className="error-note" role="alert">
        Could not load this mandate: {loadError}
      </p>
    );
  if (!mandate || reviewed) return <CurveLoader title="Loading your shortlist" />;

  const cents = (v: string) => Math.round(Number(v) * 100);
  const met = mandate.candidates.find(
    (c) => cents(c.baselinePrice) <= cents(mandate.terms.limitPrice),
  );

  return (
    <div className={s.layout}>
      {q.get("cancelled") === "1" && (
        <p className={`note-blue ${s.full}`}>You cancelled at PayPal. Nothing is held.</p>
      )}
      <TermsSummary mandate={mandate} />
      <section className={s.picks} aria-labelledby="picks-title">
        <h2 id="picks-title" className={s.title}>
          The agent can buy only one of these
        </h2>
        <CandidateCards candidates={mandate.candidates} />
        <RejectedSummary rejected={mandate.rejected} />
      </section>
      {met && (
        <p className={`note-yellow ${s.full}`} role="status">
          Heads up: {met.title} is already ${met.baselinePrice}, under your $
          {mandate.terms.limitPrice} limit, so Entole will buy it right after you approve. To see it
          wait for a drop, go back and set a lower price.
        </p>
      )}
      <ApproveBar
        className={s.full}
        id={mandate.id}
        hold={mandate.terms.budget}
        approveUrl={mandate.approveUrl}
      />
    </div>
  );
}
