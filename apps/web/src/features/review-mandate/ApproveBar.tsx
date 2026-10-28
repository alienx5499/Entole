import Link from "next/link";
import { PayPalMark } from "@/shared/ui";
import s from "./review.module.css";

type Props = { id: string; hold: string; approveUrl: string | null; className?: string };

export function ApproveBar({ id, hold, approveUrl, className = "" }: Props) {
  const ready = approveUrl?.startsWith("https://") ?? false;
  return (
    <div className={`${s.approve} ${className}`}>
      <p id="hold-explainer" className={s.explain}>
        Approving puts a ${hold} hold on your PayPal sandbox account. Nothing is charged unless one
        of these items drops to your price. The rest is released. Entole may earn a commission from
        the shop when it buys through Channel3; your price limit stays the same.
      </p>
      <div className={s.buttons}>
        {ready && approveUrl ? (
          <a className="btn btn-primary" href={approveUrl} aria-describedby="hold-explainer">
            <PayPalMark tone="white" />
            Approve the hold in PayPal
          </a>
        ) : (
          <button type="button" className="btn btn-primary" disabled>
            <PayPalMark tone="white" />
            Approve the hold in PayPal
          </button>
        )}
        <Link className="btn btn-secondary" href={`/mandates/new?from=${encodeURIComponent(id)}`}>
          Change my rules
        </Link>
      </div>
      {!ready && (
        <p className="error-note" role="alert">
          The PayPal link is missing. Change your rules to start again.
        </p>
      )}
    </div>
  );
}
