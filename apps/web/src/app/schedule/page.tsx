import type { Metadata } from "next";
import { Schedule } from "@/features/schedule";

export const metadata: Metadata = { title: "Schedule" };

// `/schedule?order=<id>` shows that one order's timeline.
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string | string[] }>;
}) {
  const { order } = await searchParams;
  return (
    <main className="flow">
      <Schedule order={typeof order === "string" && order !== "" ? order : undefined} />
    </main>
  );
}
