import { webConfig } from "@creator-outdoor/config/web";
import type { MetadataRoute } from "next";
import { fetchCategories, fetchSitemapEntries } from "@/lib/api";

/**
 * Generated per request, not at build time.
 *
 * A build runs with no API behind it, so a prerendered sitemap is always the
 * three-URL fallback below — and with a revalidate window it stayed that way
 * for an hour after every deploy, which is the one hour a crawler is most
 * likely to come looking. The two fetches inside are cached for an hour each,
 * so a crawl still does not become a load test.
 */
export const dynamic = "force-dynamic";

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
    /*
     * Both, or neither. A sitemap listing creators but no categories would
     * point crawlers at the leaves and never at the branches, and the category
     * pages are the ones worth ranking for "melhores criadores de X".
     */
    const [{ entries }, { categories }] = await Promise.all([
      fetchSitemapEntries(),
      fetchCategories(),
    ]);
    return [
      ...staticPages,
      ...categories.map((category) => ({
        url: new URL(`/categoria/${category.slug}`, origin).toString(),
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
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
