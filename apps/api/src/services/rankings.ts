import type { ProductConfig } from "@creator-outdoor/config";
import type { LeaderboardResponseDto } from "@creator-outdoor/contracts";
import { type DatabaseExecutor, getLeaderboardPage } from "@creator-outdoor/db";
import { getWeeklyPeriod } from "@creator-outdoor/domain";
import { serializeLeaderboard } from "../serializers/rankings";

export type LeaderboardRequest = {
  readonly limit: number;
  readonly offset: number;
  readonly categorySlug?: string | undefined;
  readonly now: Date;
};

/**
 * The weekly ranking.
 *
 * The active period is derived from the instant, never read from a job's
 * bookkeeping, so a rollover that runs late or twice cannot move a boost into
 * the wrong week.
 */
export async function getWeeklyLeaderboard(
  executor: DatabaseExecutor,
  product: ProductConfig,
  request: LeaderboardRequest,
): Promise<LeaderboardResponseDto> {
  const period = getWeeklyPeriod(request.now, product.timezone);
  const page = await getLeaderboardPage(executor, {
    window: { startsAt: period.startsAt, endsAt: period.endsAt },
    limit: request.limit,
    offset: request.offset,
    categorySlug: request.categorySlug,
  });
  return serializeLeaderboard({
    period,
    entries: page.entries,
    leader: page.leader,
    total: page.total,
    generatedAt: request.now,
    minIncrementCents: product.minIncrementCents,
    minBoostCents: product.minBoostCents,
  });
}

/** The general ranking: every ACTIVE boost whose payment remains CONFIRMED. */
export async function getAllTimeLeaderboard(
  executor: DatabaseExecutor,
  product: ProductConfig,
  request: LeaderboardRequest,
): Promise<LeaderboardResponseDto> {
  const page = await getLeaderboardPage(executor, {
    window: null,
    limit: request.limit,
    offset: request.offset,
    categorySlug: request.categorySlug,
  });
  return serializeLeaderboard({
    period: null,
    entries: page.entries,
    leader: page.leader,
    total: page.total,
    generatedAt: request.now,
    minIncrementCents: product.minIncrementCents,
    minBoostCents: product.minBoostCents,
  });
}
