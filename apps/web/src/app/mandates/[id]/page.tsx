import type { Metadata } from "next";
import { Suspense } from "react";
import { LiveMandate } from "@/features/live-mandate";
import { CurveLoader, Stepper } from "@/shared/ui";

export const metadata: Metadata = { title: "Your limit order" };

export default async function MandatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="flow fit">
      <Stepper current={3} />
      <Suspense fallback={<CurveLoader title="Loading your mandate" />}>
        <LiveMandate id={id} />
      </Suspense>
    </main>
  );
}
