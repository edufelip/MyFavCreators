import { type Static, Type as t } from "@sinclair/typebox";
import { CreatorSummaryDto } from "./creator";
import { AmountCents, IsoDateTime, Slug } from "./primitives";

/**
 * The window a ranking covers.
 *
 * `ALL_TIME` carries no boundaries: the general ranking is every ACTIVE boost
 * whose payment remains CONFIRMED, and it needs no period row to exist.
 */
export const RankingPeriodDto = t.Union(
  [
    t.Object({
      type: t.Literal("WEEKLY"),
      startsAt: IsoDateTime,
      endsAt: IsoDateTime,
    }),
    t.Object({ type: t.Literal("ALL_TIME") }),
  ],
  { $id: "RankingPeriod" },
);
export type RankingPeriodDto = Static<typeof RankingPeriodDto>;

export const LeaderboardEntryDto = t.Object(
  {
    rank: t.Integer({ minimum: 1 }),
    creator: CreatorSummaryDto,
    amountCents: AmountCents,
    supporterCount: t.Integer({ minimum: 0 }),
    /** Null only for a creator with no counted money in this window. */
    reachedCurrentScoreAt: t.Union([IsoDateTime, t.Null()]),
    /**
     * What it would cost to pass the current leader, quoted against the ranking
     * at `generatedAt`. Null for the leader. The quote reserves nothing.
     */
    takeFirstPlaceAmountCents: t.Union([AmountCents, t.Null()]),
  },
  { $id: "LeaderboardEntry" },
);
export type LeaderboardEntryDto = Static<typeof LeaderboardEntryDto>;

export const LeaderboardResponseDto = t.Object(
  {
    period: RankingPeriodDto,
    generatedAt: IsoDateTime,
    /** The creator holding #1 in this window, independent of pagination. */
    leader: t.Union([LeaderboardEntryDto, t.Null()]),
    entries: t.Array(LeaderboardEntryDto),
    total: t.Integer({ minimum: 0 }),
  },
  { $id: "LeaderboardResponse" },
);
export type LeaderboardResponseDto = Static<typeof LeaderboardResponseDto>;

export const LeaderboardQueryDto = t.Object({
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 30 })),
  offset: t.Optional(t.Integer({ minimum: 0, maximum: 10_000, default: 0 })),
  category: t.Optional(Slug),
});
export type LeaderboardQueryDto = Static<typeof LeaderboardQueryDto>;

export const LEADERBOARD_DEFAULT_LIMIT = 30;
export const LEADERBOARD_MAX_LIMIT = 100;
