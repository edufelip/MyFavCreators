import type {
  CreatorSummaryDto,
  LeaderboardEntryDto,
  LeaderboardResponseDto,
  RankingPeriodDto,
} from "@creator-outdoor/contracts";
import type { LeaderboardRow } from "@creator-outdoor/db";
import {
  type MoneyCents,
  moneyCents,
  takeFirstPlaceQuote,
  type WeeklyPeriod,
} from "@creator-outdoor/domain";

export type SerializeLeaderboardInput = {
  readonly period: WeeklyPeriod | null;
  readonly entries: readonly LeaderboardRow[];
  readonly leader: LeaderboardRow | null;
  readonly total: number;
  readonly generatedAt: Date;
  readonly minIncrementCents: number;
  readonly minBoostCents: number;
};

/**
 * Builds the public creator shape.
 *
 * This is an explicit allowlist. Database rows are never serialized directly,
 * so moderation metadata, claim internals and every private identifier are
 * structurally impossible to leak here.
 */
function serializeCreator(row: LeaderboardRow): CreatorSummaryDto {
  return {
    id: row.creatorId,
    slug: row.creatorSlug,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    category: { slug: row.categorySlug, name: row.categoryName },
    primaryPlatform: row.primaryPlatform,
    primaryHandle: row.primaryHandle,
  };
}

function serializeEntry(
  row: LeaderboardRow,
  leaderAmountCents: MoneyCents | null,
  minIncrementCents: number,
  minBoostCents: number,
): LeaderboardEntryDto {
  const takeFirstPlaceAmountCents =
    leaderAmountCents === null
      ? null
      : takeFirstPlaceQuote({
          leaderAmountCents,
          creatorAmountCents: row.amountCents,
          minIncrementCents: moneyCents(minIncrementCents),
          minBoostCents: moneyCents(minBoostCents),
          isCurrentLeader: row.rank === 1,
        });

  return {
    rank: row.rank,
    creator: serializeCreator(row),
    amountCents: row.amountCents,
    supporterCount: row.supporterCount,
    reachedCurrentScoreAt: row.reachedCurrentScoreAt?.toISOString() ?? null,
    takeFirstPlaceAmountCents,
  };
}

function serializePeriod(period: WeeklyPeriod | null): RankingPeriodDto {
  return period === null
    ? { type: "ALL_TIME" }
    : {
        type: "WEEKLY",
        startsAt: period.startsAt.toISOString(),
        endsAt: period.endsAt.toISOString(),
      };
}

export function serializeLeaderboard(input: SerializeLeaderboardInput): LeaderboardResponseDto {
  const leaderAmountCents = input.leader?.amountCents ?? null;
  return {
    period: serializePeriod(input.period),
    generatedAt: input.generatedAt.toISOString(),
    leader:
      input.leader === null
        ? null
        : serializeEntry(
            input.leader,
            leaderAmountCents,
            input.minIncrementCents,
            input.minBoostCents,
          ),
    entries: input.entries.map((row) =>
      serializeEntry(row, leaderAmountCents, input.minIncrementCents, input.minBoostCents),
    ),
    total: input.total,
  };
}
