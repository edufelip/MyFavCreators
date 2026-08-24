import { creatorPlatformLabel } from "@creator-outdoor/domain";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BoostForm } from "@/components/boost-form";
import { CreatorAvatar } from "@/components/creator-avatar";
import { CreatorOwnershipPanel } from "@/components/creator-ownership-panel";
import { ImpressionReporter } from "@/components/impression-reporter";
import { SiteHeader } from "@/components/site-header";
import { SupporterWall } from "@/components/supporter-wall";
import { fetchCreatorDetail, fetchTorcida } from "@/lib/api";
import { copy } from "@/lib/copy";
import { formatBrl, formatDuration, formatHandle } from "@/lib/format";

export const dynamic = "force-dynamic";

type CreatorPageProps = { readonly params: Promise<{ readonly slug: string }> };

/**
 * Only APPROVED creators reach this page, so only APPROVED creators are ever
 * indexable. Everything else 404s and carries `noindex`.
 */
export async function generateMetadata({ params }: CreatorPageProps): Promise<Metadata> {
  const { slug } = await params;
  const creator = await fetchCreatorDetail(slug);
  if (creator === null) {
    return { title: copy.creatorPage.notFound, robots: { index: false, follow: false } };
  }
  const handle =
    creator.links[0] === undefined
      ? creator.displayName
      : formatHandle(creator.links[0].handle, creator.links[0].platform);
  const description = `${creator.displayName} ${handle} · ${copy.leaderboard.weeklyAmount(
    formatBrl(creator.weekly.amountCents),
  )}`;
  return {
    title: creator.displayName,
    description,
    alternates: { canonical: `/criador/${creator.slug}` },
    openGraph: {
      type: "profile",
      title: `${creator.displayName} · ${copy.brand.name}`,
      description,
      url: `/criador/${creator.slug}`,
      images: [{ url: `/criador/${creator.slug}/opengraph-image`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: creator.displayName,
      description,
      images: [`/criador/${creator.slug}/opengraph-image`],
    },
  };
}

export default async function CreatorPage({ params }: CreatorPageProps) {
  const { slug } = await params;
  // One round trip each, in parallel: the wall is part of the page, not an
  // afterthought loaded on the client.
  const [creator, torcida] = await Promise.all([
    fetchCreatorDetail(slug),
    fetchTorcida({ slug, window: "all-time", limit: 10 }),
  ]);
  if (creator === null) {
    notFound();
  }

  const primary = creator.links.find((link) => link.isPrimary) ?? creator.links[0];
  const periodEndsAt = new Date(creator.period.endsAt);
  const countdownLabel = formatDuration(periodEndsAt.getTime() - Date.now());

  return (
    <>
      <SiteHeader periodEndsAt={creator.period.endsAt} countdownLabel={countdownLabel} />

      <main id="conteudo" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-16 pt-6">
        <section className="flex items-start gap-4 sm:gap-6">
          <CreatorAvatar
            displayName={creator.displayName}
            avatarUrl={creator.avatarUrl}
            size="lg"
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-black leading-tight text-white sm:text-3xl">
              {creator.displayName}
            </h1>
            {creator.championWeeks === 0 ? null : (
              <p
                data-testid="champion-badge"
                className="mt-1 inline-block rounded-full bg-amber-300/15 px-2 py-0.5 text-xs font-black uppercase tracking-wide text-amber-300"
              >
                {copy.hallOfFame.championBadge(creator.championWeeks)}
              </p>
            )}
            {primary === undefined ? null : (
              <p className="truncate text-sm text-white/70">
                {formatHandle(primary.handle, primary.platform)}
              </p>
            )}
            <p className="mt-1 text-xs uppercase tracking-wide text-white/60">
              {[
                creator.category.name,
                primary === undefined ? null : creatorPlatformLabel(primary.platform),
              ]
                .filter((value) => value !== null && value !== undefined)
                .join(" · ")}
            </p>
            {creator.bio === null ? null : (
              // Marked so audits can tell the creator's words from the
              // platform's: the copy rules are about what the platform says.
              <p data-testid="creator-bio" className="mt-3 text-sm text-white/70">
                {creator.bio}
              </p>
            )}
          </div>
        </section>

        <section
          aria-label={copy.creatorPage.weeklyRank}
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          <Stat
            label={copy.creatorPage.weeklyRank}
            value={creator.weekly.rank === null ? "—" : `#${creator.weekly.rank}`}
            testId="creator-weekly-rank"
          />
          <Stat
            label={copy.creatorPage.weeklyTotal}
            value={formatBrl(creator.weekly.amountCents)}
            testId="creator-weekly-amount"
          />
          <Stat
            label={copy.creatorPage.lifetimeTotal}
            value={formatBrl(creator.allTime.amountCents)}
            testId="creator-lifetime-amount"
          />
          <Stat
            label={copy.creatorPage.supporters}
            value={String(creator.allTime.supporterCount)}
            testId="creator-supporters"
          />
        </section>

        {creator.weekly.takeFirstPlaceAmountCents === null ? null : (
          <p
            data-testid="take-first-place"
            className="inline-block self-start rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold text-white/80"
          >
            {copy.cta.takeFirstPlace(formatBrl(creator.weekly.takeFirstPlaceAmountCents))}
          </p>
        )}

        <section
          id="impulsionar"
          aria-label={copy.boostForm.title}
          className="flex flex-col gap-4 scroll-mt-20"
        >
          <h2 className="text-lg font-black tracking-tight text-white">{copy.boostForm.title}</h2>
          <BoostForm
            creators={[
              {
                slug: creator.slug,
                displayName: creator.displayName,
                takeFirstPlaceAmountCents: creator.weekly.takeFirstPlaceAmountCents,
              },
            ]}
            fixedCreatorSlug={creator.slug}
          />
        </section>

        {torcida === null ? null : <SupporterWall torcida={torcida} />}

        {creator.links.length === 0 ? null : (
          <section aria-label={copy.creatorPage.links}>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-white/60">
              {copy.creatorPage.links}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {creator.links.map((link) => (
                <li key={link.id}>
                  {/* Every outbound link goes through the tracked redirect. */}
                  <a
                    href={link.outboundUrl}
                    rel="noopener noreferrer nofollow"
                    target="_blank"
                    data-testid="creator-outbound-link"
                    className="inline-block rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80 hover:border-white/40"
                  >
                    {creatorPlatformLabel(link.platform)} {formatHandle(link.handle, link.platform)}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {creator.claimStatus === "UNCLAIMED" ? <CreatorOwnershipPanel slug={creator.slug} /> : null}
      </main>

      <ImpressionReporter entries={[{ creatorId: creator.id, surface: "CREATOR_PAGE" }]} />
    </>
  );
}

function Stat({
  label,
  value,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <p className="text-xs uppercase tracking-wide text-white/55">{label}</p>
      <p data-testid={testId} className="mt-1 text-lg font-black tabular-nums text-white">
        {value}
      </p>
    </div>
  );
}
