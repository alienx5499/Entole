"use client";

import { useEffect, useState } from "react";
import { MandateForm } from "@/features/create-mandate";
import type { MandateView, MeView } from "@/shared/api";
import { getMandate, getMe } from "@/shared/api";
import { CurveLoader, Stepper } from "@/shared/ui";

export default function NewMandatePage() {
  const [me, setMe] = useState<MeView | null>(null);
  const [previous, setPrevious] = useState<MandateView | null>(null);
  const [failed, setFailed] = useState(false);

  // A 401 sends the browser to `/?login=1` inside the client.
  // `?from=<id>` comes from "Change my rules": that mandate's rules fill the form.
  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get("from");
    Promise.all([getMe(), from ? getMandate(from).catch(() => null) : null])
      .then(([user, old]) => {
        setPrevious(old);
        setMe(user);
      })
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <main role="alert">Could not reach the server. Reload to retry.</main>;
  return (
    <main className="flow">
      <Stepper current={1} />
      {me ? <MandateForm taste={me.taste} previous={previous} /> : <CurveLoader title="Loading" />}
    </main>
  );
}
