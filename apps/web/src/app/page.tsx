import { webConfig } from "@creator-outdoor/config/web";
import {
  getWeeklyPeriod,
  isHeatMode,
  millisecondsRemainingInPeriod,
} from "@creator-outdoor/domain";
import { Billboard } from "@/components/billboard";
import { BoostForm, type BoostFormCreator } from "@/components/boost-form";
import { ImpressionReporter } from "@/components/impression-reporter";
import { Leaderboard } from "@/components/leaderboard";
import { LiveRefresh } from "@/components/live-refresh";
import { OvertakeTicker } from "@/components/overtake-ticker";
import { RotationFeed } from "@/components/rotation-feed";
import { SiteHeader } from "@/components/site-header";
import {
  fetchRankEvents,
  fetchRotation,
  loadLeaderboard,
  loadOptional,
  type RankingTab,
} from "@/lib/api";
import { copy } from "@/lib/copy";
import { formatDuration } from "@/lib/format";

/**
 * The ranking is live, so the homepage renders per request rather than being
 * prerendered at build time. The initial render is still server-side HTML, so
 * the ranking is indexable.
 */
export const dynamic = "force-dynamic";

const LEADERBOARD_LIMIT = 30;

type HomePageProps = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resolveTab(value: string | string[] | undefined): RankingTab {
  return value === "geral" ? "all-time" : "weekly";
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const tab = resolveTab(params["ranking"]);

  // The billboard always belongs to the creator holding #1 *this week*, whether
  // or not the visitor is looking at the general ranking. A previous champion
  // never keeps the marquee either.
  const [weekly, listed, rotation, rankEvents] = await Promise.all([
    loadLeaderboard({ tab: "weekly", limit: LEADERBOARD_LIMIT }),
    tab === "weekly"
      ? Promise.resolve(null)
      : loadLeaderboard({ tab: "all-time", limit: LEADERBOARD_LIMIT }),
    // Supporting surfaces: if either is unavailable the ranking is still right
    // and still worth showing, so they render nothing rather than failing.
    loadOptional(() => fetchRotation()),
    loadOptional(() => fetchRankEvents(8)),
  ]);
  const listResult = listed ?? weekly;

  // The countdown describes the current weekly period, computed from the
  // instant rather than read from any job's bookkeeping.
  const now = new Date();
  const period = getWeeklyPeriod(now, webConfig.product.timezone);
  const countdownLabel = formatDuration(millisecondsRemainingInPeriod(now, period));
  // Styling only. Heat mode never changes how a ranking is calculated.
  const heat = isHeatMode(now, period);

  const leader = weekly.ok ? weekly.data.leader : null;

  // The boost form offers the creators currently on the leaderboard, each with
  // the Take #1 quote calculated by the API at this instant.
  const boostableCreators: BoostFormCreator[] = (weekly.ok ? weekly.data.entries : []).map(
    (entry) => ({
      slug: entry.creator.slug,
      displayName: entry.creator.displayName,
      takeFirstPlaceAmountCents: entry.takeFirstPlaceAmountCents,
    }),
  );

  /**
   * What this render put in front of the visitor.
   *
   * Built from the entries actually rendered, not from what was requested, so
   * a surface that failed to load reports nothing rather than claiming a
   * delivery that never happened.
   */
  const shown: Array<{ creatorId: string; surface: "MARQUEE" | "LEADERBOARD" | "ROTATION" }> = [];
  if (leader !== null) {
    shown.push({ creatorId: leader.creator.id, surface: "MARQUEE" });
  }
  for (const entry of listResult.ok ? listResult.data.entries : []) {
    shown.push({ creatorId: entry.creator.id, surface: "LEADERBOARD" });
  }
  for (const entry of rotation?.entries ?? []) {
    shown.push({ creatorId: entry.creator.id, surface: "ROTATION" });
  }

  return (
    <>
      <SiteHeader
        periodEndsAt={period.endsAt.toISOString()}
        countdownLabel={countdownLabel}
        heatMode={heat}
      />

      <main id="conteudo" className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-16 pt-6">
        <section className="flex flex-col gap-1">
          <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
            {copy.hero.headline}
          </h2>
          <p className="text-sm text-white/60 sm:text-base">{copy.hero.subheadline}</p>
        </section>

        {leader === null ? null : <Billboard leader={leader} />}

        {boostableCreators.length === 0 ? null : (
          <section aria-label={copy.boostForm.title} className="flex flex-col gap-4">
            <h2 className="text-lg font-black tracking-tight text-white">{copy.boostForm.title}</h2>
            <BoostForm creators={boostableCreators} />
          </section>
        )}

        <RotationFeed rotation={rotation} />

        <Leaderboard
          tab={tab}
          entries={listResult.ok ? listResult.data.entries : []}
          unavailable={!listResult.ok}
        />

        <OvertakeTicker events={rankEvents} now={now} />
      </main>

      <LiveRefresh />
      <ImpressionReporter entries={shown} />
    </>
  );
}
