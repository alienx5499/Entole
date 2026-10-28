"use client";

import { useState } from "react";
import type { MandateView } from "@/shared/api";
import { PayPalMark } from "@/shared/ui";
import s from "./Receipt.module.css";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) : null;

/** Monospace value with a copy button; if the clipboard is blocked the text stays selectable. */
function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // the value is already on screen to select by hand
    }
  }
  return (
    <span className={s.copyRow}>
      <span className="mono">{value}</span>
      <button
        type="button"
        className={`btn btn-ghost ${s.copy}`}
        aria-label={`Copy ${label}`}
        onClick={copy}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <span className={s.sr} aria-live="polite">
        {copied ? `${label} copied` : ""}
      </span>
    </span>
  );
}

/** True once PayPal has been involved: a hold exists or PayPal has sent a confirmation. */
export const hasReceipt = (m: MandateView) =>
  m.receipt.authorizationId !== null || m.receipt.confirmations.length > 0;

export function Receipt({ mandate: m }: { mandate: MandateView }) {
  const r = m.receipt;
  const ids: [string, string | null][] = [
    ["PayPal order ID", r.paypalOrderId],
    ["Authorization ID", r.authorizationId],
    ["Capture ID", r.captureId],
    ["Refund ID", r.refundId],
  ];
  const money: [string, string, string | null][] = [
    ["Held", r.amounts.held, r.times.approved],
    ["Captured", r.amounts.captured, r.times.captured],
    ["Released", r.amounts.released, r.times.released],
    ["Refunded", r.amounts.refunded, r.times.refunded],
  ];
  const p = m.purchase;
  return (
    <section className={`card ${s.receipt}`} aria-labelledby="receipt-title" data-print-root>
      <div className={s.head}>
        <h3 id="receipt-title">Receipt</h3>
        <button
          type="button"
          className={`btn btn-secondary ${s.print}`}
          onClick={() => window.print()}
        >
          Print receipt
        </button>
      </div>
      <p className={s.soft}>Sandbox only: no real money moved.</p>

      <h4>What you signed</h4>
      <p>
        {m.terms.query}, up to <span className="mono">${m.terms.limitPrice}</span>
      </p>
      <ul>
        {m.candidates.map((c) => (
          <li key={`${c.productId}-${c.merchant}`}>
            {c.title}, baseline <span className="mono">${c.baselinePrice}</span> at{" "}
            {c.shops.join(", ")}
          </li>
        ))}
      </ul>

      <h4>Digest</h4>
      <CopyValue label="digest" value={m.digest} />
      <p className={s.soft}>
        This fingerprint of your rules is stored inside the PayPal order, so the rules cannot change
        after you approve.
      </p>
      <p>
        <a href={`/api/mandates/${encodeURIComponent(m.id)}/ap2`} download>
          Download AP2 mandate
        </a>{" "}
        <span className={s.soft}>
          (these terms in the Agent Payments Protocol format, unsigned JSON)
        </span>
      </p>

      <h4>
        <PayPalMark />
        PayPal IDs
      </h4>
      <dl className={s.list}>
        {ids.map(([label, id]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {id ? (
                <CopyValue label={label} value={id} />
              ) : (
                <span className={s.soft}>none yet</span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {r.holdRenewed && (
        <>
          <h4>Hold renewed</h4>
          <p>
            PayPal guarantees a hold for 3 days, so Entole renewed it on {when(r.holdRenewed.at)}.
            The new authorization replaces{" "}
            <span className="mono">{r.holdRenewed.previousAuthorizationId}</span>.
          </p>
        </>
      )}

      <h4>Money</h4>
      <dl className={s.list}>
        {money.map(([label, amount, at]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <span className="mono">${amount}</span>
              {when(at) && <span className={s.soft}> on {when(at)}</span>}
            </dd>
          </div>
        ))}
      </dl>

      {p?.paypal.status && (
        <>
          <h4>
            <PayPalMark />
            PayPal on the capture
          </h4>
          <dl className={s.list}>
            <div>
              <dt>Status</dt>
              <dd className="mono">{p.paypal.status}</dd>
            </div>
            {p.paypal.sellerProtection && (
              <div>
                <dt>Seller protection</dt>
                <dd className="mono">{p.paypal.sellerProtection}</dd>
              </div>
            )}
            {p.paypal.fee && (
              <div>
                <dt>PayPal fee</dt>
                <dd className="mono">${p.paypal.fee}</dd>
              </div>
            )}
            {p.paypal.net && (
              <div>
                <dt>Net to merchant</dt>
                <dd className="mono">${p.paypal.net}</dd>
              </div>
            )}
          </dl>
        </>
      )}

      {p && (
        <>
          <h4>Delivery</h4>
          {p.shipTo ? (
            <address className={s.address}>
              {p.shipTo.name && (
                <>
                  {p.shipTo.name}
                  <br />
                </>
              )}
              {p.shipTo.lines.map((l) => (
                <span key={l}>
                  {l}
                  <br />
                </span>
              ))}
              {p.shipTo.city}, {p.shipTo.region} {p.shipTo.postalCode}, {p.shipTo.country}
            </address>
          ) : (
            <p className={s.soft}>No ship-to address on the PayPal account.</p>
          )}
          <p className={s.soft}>
            Ship-to comes from your PayPal approval. In this sandbox demo Entole does not place the
            order with {p.merchant}.
          </p>
        </>
      )}

      {p && (
        <>
          <h4>Why this one</h4>
          <p>
            {p.title} from {p.merchant}
            {p.shopsCompared > 1 && `, the cheapest of ${p.shopsCompared} shops`}.{" "}
            {p.whyThisOne.chosen}
          </p>
          <p className={s.soft}>
            Entole may earn a commission from the shop on purchases made through Channel3.
          </p>
          {p.whyThisOne.skipped.length > 0 && (
            <ul>
              {p.whyThisOne.skipped.map((k) => (
                <li key={k.title}>
                  {k.title}: {k.reasons.join("; ")}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <h4>
        <PayPalMark />
        Confirmed by PayPal
      </h4>
      {r.confirmations.length === 0 ? (
        <p className={s.soft}>No PayPal confirmations received yet.</p>
      ) : (
        <ul>
          {r.confirmations.map((c) => (
            <li key={c.eventId}>
              {c.message} <span className={s.soft}>({when(c.at)})</span>
              <br />
              <span className="mono">{c.eventType}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
