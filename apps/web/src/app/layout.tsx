import { webConfig } from "@creator-outdoor/config/web";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { copy } from "@/lib/copy";
import "./globals.css";

export const metadata: Metadata = {
  /**
   * Resolves every relative URL in metadata — canonicals, OG images, the
   * sitemap link. Without it Next falls back to localhost, which is what a
   * social card scraper would then try to fetch in production.
   */
  metadataBase: new URL(webConfig.webOrigin),
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
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", images: ["/opengraph-image"] },
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
        {/*
          A keyboard user should not have to tab through the header on every
          page to reach the ranking, which is the page.
        */}
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-amber-300 focus:px-4 focus:py-2 focus:text-sm focus:font-black focus:text-neutral-950"
        >
          {copy.nav.skipToContent}
        </a>
        {children}
      </body>
    </html>
  );
}
