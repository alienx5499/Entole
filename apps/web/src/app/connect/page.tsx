import type { Metadata } from "next";
import { ConnectAi } from "@/features/connect-ai";

export const metadata: Metadata = { title: "Connect an AI" };

export default function ConnectPage() {
  return (
    <main className="flow">
      <ConnectAi />
    </main>
  );
}
