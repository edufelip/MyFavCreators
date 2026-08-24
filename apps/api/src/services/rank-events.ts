import type { ProductConfig } from "@creator-outdoor/config";
import type { RankEventListDto } from "@creator-outdoor/contracts";
import {
  countCreatorsWithScoreAbove,
  type Database,
  ensureWeeklyPeriod,
  findWeeklyPeriod,
  getCreatorStanding,
  insertRankEvents,
  listRecentRankEvents,
} from "@creator-outdoor/db";
import { getWeeklyPeriod } from "@creator-outdoor/domain";

/**
 * Records the overtakes a newly activated boost caused.
 *
 * Deliberately outside the payment transaction. The ticker is a nice touch; a
 * correct payment is not negotiable, and a failure here must never roll back an
 * activation or delay a confirmation. If it fails, the ranking is still right —
 * only the ticker misses a line.
 */
export async function recordOvertakes(
  database: Database,
  product: ProductConfig,
  input: {
    readonly creatorId: string;
    readonly boostAmountCents: number;
    readonly now: Date;
  },
): Promise<void> {
  const period = getWeeklyPeriod(input.now, product.timezone);
  const window = { startsAt: period.startsAt, endsAt: period.endsAt };

  const standing = await getCreatorStanding(database, input.creatorId, window);
  if (standing.rank === null) {
    return;
  }

  const amountBefore = standing.amountCents - input.boostAmountCents;
  const rankBefore =
    amountBefore <= 0
      ? null
      : (await countCreatorsWithScoreAbove(database, {
          ...window,
          amountCents: amountBefore,
          // The creator's own new total is not a rival standing ahead of their
          // old one; counting it would post an overtake that never happened.
          excludeCreatorId: input.creatorId,
        })) + 1;

  // Entering the ranking is not an overtake, and neither is standing still.
  if (rankBefore === null || rankBefore <= standing.rank) {
    return;
  }

  const periodRow = await ensureWeeklyPeriod(database, window);
  await insertRankEvents(database, periodRow.id, [
    {
      creatorId: input.creatorId,
      // The creator now directly below is the one visibly passed.
      passedCreatorId: null,
      fromRank: rankBefore,
      toRank: standing.rank,
    },
  ]);
}

export async function getRecentRankEvents(
  database: Database,
  product: ProductConfig,
  now: Date,
  limit: number,
): Promise<RankEventListDto> {
  const period = getWeeklyPeriod(now, product.timezone);
  const periodRow = await findWeeklyPeriod(database, {
    startsAt: period.startsAt,
    endsAt: period.endsAt,
  });
  if (periodRow === null) {
    return { events: [] };
  }

  const events = await listRecentRankEvents(database, periodRow.id, limit);
  return {
    events: events.map((event) => ({
      id: event.id,
      creatorSlug: event.creatorSlug,
      creatorDisplayName: event.creatorDisplayName,
      passedCreatorSlug: event.passedCreatorSlug,
      passedCreatorDisplayName: event.passedCreatorDisplayName,
      fromRank: event.fromRank,
      toRank: event.toRank,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}
