import type { Metadata } from "next";
import Link from "next/link";
import { ImageSlot } from "@/shared/ui";
import s from "./not-found.module.css";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className={s.page}>
      <div className={s.text}>
        <p className={s.code}>Error 404</p>
        <h1 className={s.lead}>
          <strong>This price never showed up.</strong>{" "}
          <span>
            The courier waited at this address, but nothing is listed here, or the page has moved.
            These links lead back to your orders.
          </span>
        </h1>
        <p className={s.actions}>
          <Link className="btn btn-primary" href="/">
            Back to home
          </Link>
          <Link className="btn btn-secondary" href="/mandates">
            Your limit orders
          </Link>
          <Link className="btn btn-secondary" href="/#how-it-works">
            How it works
          </Link>
        </p>
      </div>
      <div className={s.art}>
        <ImageSlot
          src="/img/not-found.webp"
          alt="A tiny courier waiting where the price path ends at the edge of the map"
          width={2172}
          height={724}
          fallback={null}
        />
      </div>
    </main>
  );
}
