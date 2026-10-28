"use client";

import { useEffect, useState } from "react";
import {
  BuiltWith,
  Hero,
  HowItWorks,
  LandingFooter,
  LandingShell,
  Problem,
  TryIt,
  WhyItsSafe,
} from "@/features/landing";
import { ApiError, getSession } from "@/shared/api";

// The landing content is static, so it renders at once; only the hero button waits for the login check.
export default function Home() {
  const [state, setState] = useState<"loading" | "anon" | "user" | "error">("loading");
  const [relogin, setRelogin] = useState(false);

  useEffect(() => {
    setRelogin(new URLSearchParams(window.location.search).get("login") === "1");
    getSession()
      .then(() => setState("user"))
      .catch((e) => setState(e instanceof ApiError && e.status === 401 ? "anon" : "error"));
  }, []);

  return (
    <LandingShell>
      {relogin && (
        <p className="error-note" role="alert">
          Please log in again
        </p>
      )}
      {state === "error" && (
        <p className="error-note" role="alert">
          Could not reach the server. Reload to retry.
        </p>
      )}
      <Hero signedIn={state === "loading" ? null : state === "user"} />
      <Problem />
      <HowItWorks />
      <WhyItsSafe />
      <TryIt />
      <BuiltWith />
      <LandingFooter />
    </LandingShell>
  );
}
