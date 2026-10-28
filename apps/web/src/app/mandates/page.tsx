import type { Metadata } from "next";
import { MandateList } from "@/features/mandate-list";

export const metadata: Metadata = { title: "Your limit orders" };

export default function MandatesIndex() {
  return (
    <main className="flow">
      <MandateList />
    </main>
  );
}
