import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BootSplash } from "@/shared/ui/BootSplash";
import { fontClassNames } from "@/shared/ui/fonts";
import { SiteHeader } from "@/shared/ui/SiteHeader";
import "@/shared/ui/globals.css";
import "@/shared/ui/buttons.css";

export const metadata: Metadata = {
  title: { default: "Entole: tell it your price", template: "%s · Entole" },
  description:
    "A limit order for AI shopping. An agent waits for your price, and a PayPal hold pays only for the exact item you signed. PayPal sandbox demo.",
  openGraph: {
    title: "Entole",
    description: "Tell it your price. Agent shops, your signature pays.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontClassNames}>
      <body>
        <SiteHeader />
        {children}
        <BootSplash />
        {/* Cookieless page view counts in Vercel Web Analytics. */}
        <Analytics />
      </body>
    </html>
  );
}
