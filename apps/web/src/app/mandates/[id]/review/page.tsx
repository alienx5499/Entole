import type { Metadata } from "next";
import { Suspense } from "react";
import { ReviewMandate } from "@/features/review-mandate";
import { CurveLoader, Stepper } from "@/shared/ui";

export const metadata: Metadata = { title: "Review and approve" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="flow">
      <Stepper current={2} />
      <Suspense fallback={<CurveLoader title="Loading your shortlist" />}>
        <ReviewMandate id={id} />
      </Suspense>
    </main>
  );
}
