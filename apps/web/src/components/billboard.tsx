import type { LeaderboardEntryDto } from "@creator-outdoor/contracts";
import { creatorPlatformLabel } from "@creator-outdoor/domain";
import { CreatorAvatar } from "@/components/creator-avatar";
import { copy } from "@/lib/copy";
import { formatBrl, formatHandle } from "@/lib/format";

export type BillboardProps = {
  readonly leader: LeaderboardEntryDto;
};

/**
 * The outdoor itself: the creator holding #1 this week gets the dominant
 * placement. A previous champion never keeps this slot.
 */
export function Billboard({ leader }: BillboardProps) {
  const { creator } = leader;
  const platform =
    creator.primaryPlatform === null ? null : creatorPlatformLabel(creator.primaryPlatform);

  return (
    <section
      data-testid="billboard"
      aria-label={copy.billboard.eyebrow}
      className="relative overflow-hidden rounded-2xl border border-amber-300/25 bg-gradient-to-br from-amber-400/20 via-neutral-900 to-neutral-950 p-5 sm:p-7"
    >
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
        {copy.billboard.eyebrow}
      </p>

      <div className="mt-4 flex items-start gap-4 sm:gap-6">
        <CreatorAvatar displayName={creator.displayName} avatarUrl={creator.avatarUrl} size="lg" />

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-black leading-tight text-white sm:text-4xl">
            <a href={`/criador/${creator.slug}`} className="underline-offset-4 hover:underline">
              {creator.displayName}
            </a>
          </h1>
          {creator.primaryHandle !== null ? (
            <p className="truncate text-sm text-white/70 sm:text-base">
              {formatHandle(creator.primaryHandle, creator.primaryPlatform)}
            </p>
          ) : null}
          <p className="mt-1 text-xs uppercase tracking-wide text-white/50 sm:text-sm">
            {[creator.category.name, platform].filter((value) => value !== null).join(" · ")}
          </p>

          <p className="mt-4 text-3xl font-black tabular-nums text-amber-300 sm:text-5xl">
            {formatBrl(leader.amountCents)}
          </p>
          <p className="text-sm text-white/60">
            {copy.leaderboard.amountSuffix.weekly} ·{" "}
            {copy.leaderboard.supporters(leader.supporterCount)}
          </p>
        </div>
      </div>

      <button
        type="button"
        disabled
        aria-disabled="true"
        className="mt-6 w-full cursor-not-allowed rounded-xl bg-amber-400/90 px-5 py-3 text-base font-black uppercase tracking-wide text-neutral-950 opacity-70 sm:w-auto sm:px-10"
      >
        {copy.cta.boost}
        <span className="ml-2 text-xs font-semibold normal-case">({copy.cta.comingSoon})</span>
      </button>
    </section>
  );
}
