import { webConfig } from "@creator-outdoor/config/web";
import type { MetadataRoute } from "next";
import { fetchSitemapEntries } from "@/lib/api";

export const revalidate = 3_600;

/**
 * The public map of the site.
 *
 * Only APPROVED creators appear, which is the same rule every public read
 * follows: listing a pending or removed profile would publish the moderation
 * queue and point crawlers at pages that 404.
 *
 * A failure here returns the static pages rather than throwing. A missing
 * sitemap costs some crawl efficiency; a 500 on `/sitemap.xml` costs the whole
 * file.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = webConfig.webOrigin;
  const staticPages: MetadataRoute.Sitemap = [
    { url: origin, changeFrequency: "hourly", priority: 1 },
    { url: new URL("/hall-da-fama", origin).toString(), changeFrequency: "weekly", priority: 0.6 },
    { url: new URL("/regras", origin).toString(), changeFrequency: "monthly", priority: 0.3 },
  ];

  try {
    const { entries } = await fetchSitemapEntries();
    return [
      ...staticPages,
      ...entries.map((entry) => ({
        url: new URL(`/criador/${entry.slug}`, origin).toString(),
        lastModified: new Date(entry.updatedAt),
        changeFrequency: "daily" as const,
        priority: 0.8,
      })),
    ];
  } catch (error) {
    console.error("sitemap_failed", error instanceof Error ? error.name : "unknown");
    return staticPages;
  }
}
