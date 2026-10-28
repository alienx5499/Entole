"use client";

import { useState } from "react";
import s from "./PayPalLoginButton.module.css";

const START_URL = "/api/auth/paypal/start";

type Props = { disabled?: boolean; sandboxNote?: boolean; message?: boolean };

/** Login link in the app's primary button style. The logo is only ever the official file at /paypal-logo.svg. */
export function PayPalLoginButton({
  disabled = false,
  sandboxNote = false,
  message = false,
}: Props) {
  const [logoOk, setLogoOk] = useState(true);

  return (
    <span className={s.wrap}>
      <a
        className="btn btn-primary"
        href={disabled ? undefined : START_URL}
        aria-disabled={disabled || undefined}
      >
        {logoOk && (
          // biome-ignore lint/performance/noImgElement: tiny static SVG, onError must hide it
          <img
            className={s.logo}
            src="/paypal-logo.svg"
            alt=""
            height={18}
            onError={() => setLogoOk(false)}
          />
        )}
        Log in with PayPal
      </a>
      {sandboxNote && <span className={s.note}>Sandbox</span>}
      {message && (
        <span className={s.message}>
          PayPal confirms who you are. Entole never sees your PayPal password, and money only moves
          through the hold you approve.
        </span>
      )}
    </span>
  );
}
