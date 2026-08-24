import type { Metadata } from "next";
import type { ReactNode } from "react";
import { adminCopy } from "@/lib/copy";
import "./globals.css";

export const metadata: Metadata = {
  title: adminCopy.brand,
  // The administration surface is never indexed.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh bg-neutral-950 text-neutral-50 antialiased">{children}</body>
    </html>
  );
}
