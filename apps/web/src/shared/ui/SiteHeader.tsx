"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSession, logout, type MeView } from "@/shared/api";
import { PayPalLoginButton } from "./PayPalLoginButton";
import s from "./SiteHeader.module.css";
import { useDismiss } from "./use-dismiss";

type Session = "loading" | "anon" | "in";

function initials(label: string): string {
  const [first = "?", second] = label.split(/[\s@._-]+/).filter(Boolean);
  return (second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2)).toUpperCase();
}

export function SiteHeader() {
  const [me, setMe] = useState<MeView | null>(null);
  const [session, setSession] = useState<Session>("loading");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setOpen(false), []);
  useDismiss(menuRef, open, closeMenu);

  useEffect(() => {
    getSession()
      .then((m) => {
        setMe(m);
        setSession("in");
      })
      // 401 means logged out; any other failure also shows the login button, never a redirect.
      .catch(() => setSession("anon"));
  }, []);

  async function onLogout() {
    setBusy(true);
    try {
      await logout();
    } finally {
      window.location.assign("/");
    }
  }

  const label = me ? me.user.name || me.user.email : "";

  return (
    <header className={s.bar}>
      <Link href="/" className={s.brand}>
        {/* biome-ignore lint/performance/noImgElement: small static brand mark */}
        <img className={s.mark} src="/img/logo-header.webp" alt="" width={56} height={28} />
        <span className={s.word}>Entole</span>
      </Link>
      {session === "in" && me && (
        <div className={s.user} ref={menuRef}>
          <button
            type="button"
            className={s.trigger}
            aria-haspopup="true"
            aria-expanded={open}
            aria-controls="account-menu"
            onClick={() => setOpen((o) => !o)}
          >
            <span className={s.avatar} aria-hidden="true">
              {initials(label)}
            </span>
            <span className={s.name}>{label}</span>
            <span className={s.caret} aria-hidden="true">
              ▾
            </span>
          </button>
          {open && (
            <nav id="account-menu" className={s.menu} aria-label="Account">
              <Link href="/mandates" onClick={() => setOpen(false)}>
                Your limit orders
              </Link>
              <Link href="/dashboard" onClick={() => setOpen(false)}>
                Dashboard
              </Link>
              <Link href="/schedule" onClick={() => setOpen(false)}>
                Schedule
              </Link>
              <Link href="/mandates/new" onClick={() => setOpen(false)}>
                New limit order
              </Link>
              <Link href="/connect" onClick={() => setOpen(false)}>
                Connect an AI
              </Link>
              <button type="button" disabled={busy} onClick={onLogout}>
                {busy ? "Logging out" : "Log out"}
              </button>
            </nav>
          )}
        </div>
      )}
      {session === "anon" && <PayPalLoginButton />}
    </header>
  );
}
