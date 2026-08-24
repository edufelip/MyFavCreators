import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { copy } from "@/lib/copy";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${copy.brand.name} - ${copy.hero.headline}`,
    template: `%s | ${copy.brand.name}`,
  },
  description: copy.hero.subheadline,
  applicationName: copy.brand.name,
  openGraph: {
    type: "website",
    siteName: copy.brand.name,
    locale: "pt_BR",
    title: `${copy.brand.name} - ${copy.hero.headline}`,
    description: copy.hero.subheadline,
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh bg-neutral-950 font-sans text-neutral-50 antialiased">
        {children}
      </body>
    </html>
  );
}
