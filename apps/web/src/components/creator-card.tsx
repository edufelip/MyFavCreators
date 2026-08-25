import type { LeaderboardEntryDto } from "@creator-outdoor/contracts";
import { creatorPlatformLabel } from "@creator-outdoor/domain";
import { CreatorAvatar } from "@/components/creator-avatar";
import type { RankingTab } from "@/lib/api";
import { copy } from "@/lib/copy";
import { formatBrl, formatHandle } from "@/lib/format";

export type CreatorCardProps = {
  readonly entry: LeaderboardEntryDto;
  readonly tab: RankingTab;
};

/**
 * A leaderboard row: position, creator, what the week bought, and what it would
 * cost to take #1. Deliberately not overloaded.
 */
export function CreatorCard({ entry, tab }: CreatorCardProps) {
  const { creator } = entry;
  const platform =
    creator.primaryPlatform === null ? null : creatorPlatformLabel(creator.primaryPlatform);
  const amountLabel =
    tab === "weekly"
      ? copy.leaderboard.weeklyAmount(formatBrl(entry.amountCents))
      : copy.leaderboard.allTimeAmount(formatBrl(entry.amountCents));

  return (
    <li
      data-testid="creator-card"
      className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:gap-4 sm:p-4"
    >
      <span className="w-8 shrink-0 pt-1 text-lg font-black tabular-nums text-white/55 sm:text-xl">
        #{entry.rank}
      </span>

      <CreatorAvatar displayName={creator.displayName} avatarUrl={creator.avatarUrl} size="sm" />

      <div className="min-w-0 flex-1">
        <a
          href={`/criador/${creator.slug}`}
          data-testid="creator-profile-link"
          className="truncate text-base font-bold text-white underline-offset-2 hover:underline"
        >
          {creator.displayName}
        </a>
        {creator.primaryHandle !== null ? (
          <p className="truncate text-sm text-white/60">
            {formatHandle(creator.primaryHandle, creator.primaryPlatform)}
          </p>
        ) : null}
        <p className="truncate text-xs uppercase tracking-wide text-white/55">
          <a
            href={`/categoria/${creator.category.slug}`}
            data-testid="creator-category-link"
            className="underline-offset-2 hover:text-white hover:underline"
          >
            {creator.category.name}
          </a>
          {platform === null ? null : ` · ${platform}`}
        </p>

        <p className="mt-2 text-sm font-semibold tabular-nums text-amber-300">{amountLabel}</p>
        <p className="text-xs text-white/60">{copy.leaderboard.supporters(entry.supporterCount)}</p>

        {entry.takeFirstPlaceAmountCents === null ? null : (
          <p
            data-testid="take-first-place"
            className="mt-2 inline-block rounded-md border border-white/15 px-2 py-1 text-xs font-semibold text-white/80"
          >
            {copy.cta.takeFirstPlace(formatBrl(entry.takeFirstPlaceAmountCents))}
          </p>
        )}
      </div>
    </li>
  );
}
