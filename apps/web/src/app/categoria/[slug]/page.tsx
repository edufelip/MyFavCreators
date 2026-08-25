import { webConfig } from "@creator-outdoor/config/web";
import {
  getWeeklyPeriod,
  isHeatMode,
  millisecondsRemainingInPeriod,
} from "@creator-outdoor/domain";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ImpressionReporter } from "@/components/impression-reporter";
import { Leaderboard } from "@/components/leaderboard";
import { LiveRefresh } from "@/components/live-refresh";
import { SiteHeader } from "@/components/site-header";
import { fetchCategories, loadLeaderboard, loadOptional, type RankingTab } from "@/lib/api";
import { copy } from "@/lib/copy";
import { formatDuration } from "@/lib/format";

/** The ranking is live, so this renders per request rather than at build time. */
export const dynamic = "force-dynamic";

const LEADERBOARD_LIMIT = 30;

type CategoryPageProps = {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resolveTab(value: string | string[] | undefined): RankingTab {
  return value === "geral" ? "all-time" : "weekly";
}

/**
 * The category, or `null`.
 *
 * Resolved against the published list rather than trusted from the URL: a page
 * that rendered an empty ranking for any slug somebody typed would be an
 * endless supply of thin, indexable pages saying nothing.
 */
async function findCategory(slug: string) {
  const listed = await loadOptional(() => fetchCategories());
  return listed?.categories.find((category) => category.slug === slug) ?? null;
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const category = await findCategory((await params).slug);
  if (category === null) {
    return { title: copy.category.notFoundTitle };
  }
  return {
    title: copy.category.title(category.name),
    description: copy.category.description(category.name),
    alternates: { canonical: `/categoria/${category.slug}` },
  };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const category = await findCategory(slug);
  if (category === null) {
    notFound();
  }

  const tab = resolveTab((await searchParams)["ranking"]);
  const listed = await loadLeaderboard({ tab, limit: LEADERBOARD_LIMIT, category: slug });

  const now = new Date();
  const period = getWeeklyPeriod(now, webConfig.product.timezone);
  const countdownLabel = formatDuration(millisecondsRemainingInPeriod(now, period));

  const entries = listed.ok ? listed.data.entries : [];

  return (
    <>
      <SiteHeader
        periodEndsAt={period.endsAt.toISOString()}
        countdownLabel={countdownLabel}
        heatMode={isHeatMode(now, period)}
      />

      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-16 pt-6">
        <section className="flex flex-col gap-1">
          <h1
            data-testid="category-title"
            className="text-xl font-black tracking-tight text-white sm:text-2xl"
          >
            {copy.category.heading(category.name)}
          </h1>
          <p className="text-sm text-white/60">{copy.category.description(category.name)}</p>
        </section>

        <Leaderboard
          tab={tab}
          entries={entries}
          unavailable={!listed.ok}
          basePath={`/categoria/${category.slug}`}
        />

        {entries.length === 0 && listed.ok ? (
          <p data-testid="category-empty" className="text-sm text-white/60">
            {copy.category.empty}
          </p>
        ) : null}

        <p className="text-sm">
          <a href="/" className="text-white/70 underline underline-offset-2 hover:text-white">
            {copy.category.backToAll}
          </a>
        </p>
      </main>

      {/*
       * The same measurement the homepage does. A creator seen on a category
       * page was seen, and their delivery report has to say so.
       */}
      <ImpressionReporter
        entries={entries.map((entry) => ({
          creatorId: entry.creator.id,
          surface: "LEADERBOARD" as const,
        }))}
      />
      <LiveRefresh />
    </>
  );
}
