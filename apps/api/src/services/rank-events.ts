import type { ProductConfig } from "@creator-outdoor/config";
import type { RankEventListDto } from "@creator-outdoor/contracts";
import {
  countCreatorsWithScoreAbove,
  type Database,
  ensureWeeklyPeriod,
  findCreatorAtRank,
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
export type LeaderChange = {
  readonly previousLeaderId: string;
  readonly newLeaderId: string;
};

/**
 * Whether an activation took first place from somebody.
 *
 * Deliberately not derived from the overtake ticker. The ticker describes a
 * creator's own climb and stays silent when somebody *enters* the ranking,
 * which is right for "subiu de 5o para 2o" and wrong here: a newcomer who buys
 * the top spot outright has dethroned the leader just as surely as a regular
 * who climbed past them, and the leader's followers asked to hear about that.
 *
 * Returns null when the creator is not now #1, or when they already were, so a
 * leader extending their own lead notifies nobody.
 */
export async function detectLeaderChange(
  database: Database,
  product: ProductConfig,
  input: {
    readonly creatorId: string;
    readonly boostAmountCents: number;
    readonly now: Date;
  },
): Promise<LeaderChange | null> {
  const period = getWeeklyPeriod(input.now, product.timezone);
  const window = { startsAt: period.startsAt, endsAt: period.endsAt };

  const standing = await getCreatorStanding(database, input.creatorId, window);
  if (standing.rank !== 1) {
    return null;
  }

  const amountBefore = standing.amountCents - input.boostAmountCents;
  const aheadBefore = await countCreatorsWithScoreAbove(database, {
    ...window,
    amountCents: amountBefore,
    // Their own new total is not a rival standing ahead of their old one.
    excludeCreatorId: input.creatorId,
  });
  if (aheadBefore === 0) {
    // Nobody was above them before this boost: they were already #1.
    return null;
  }

  // The creator now standing directly below is the one who just lost the top.
  const previous = await findCreatorAtRank(database, { ...window, rank: 2 });
  return previous === null
    ? null
    : { previousLeaderId: previous.creatorId, newLeaderId: input.creatorId };
}

export type RecordedOvertake = {
  readonly rankEventId: string;
  readonly creatorId: string;
  readonly passedCreatorId: string | null;
  readonly fromRank: number;
  readonly toRank: number;
};

export async function recordOvertakes(
  database: Database,
  product: ProductConfig,
  input: {
    readonly creatorId: string;
    readonly boostAmountCents: number;
    readonly now: Date;
  },
): Promise<RecordedOvertake | null> {
  const period = getWeeklyPeriod(input.now, product.timezone);
  const window = { startsAt: period.startsAt, endsAt: period.endsAt };

  const standing = await getCreatorStanding(database, input.creatorId, window);
  if (standing.rank === null) {
    return null;
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
    return null;
  }

  // The creator now standing directly below is the one visibly passed.
  const passed = await findCreatorAtRank(database, { ...window, rank: standing.rank + 1 });
  const periodRow = await ensureWeeklyPeriod(database, window);
  const [rankEventId] = await insertRankEvents(database, periodRow.id, [
    {
      creatorId: input.creatorId,
      passedCreatorId: passed?.creatorId ?? null,
      fromRank: rankBefore,
      toRank: standing.rank,
    },
  ]);
  if (rankEventId === undefined) {
    return null;
  }

  return {
    rankEventId,
    creatorId: input.creatorId,
    passedCreatorId: passed?.creatorId ?? null,
    fromRank: rankBefore,
    toRank: standing.rank,
  };
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
