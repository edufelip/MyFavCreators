import type { MoneyCents } from "../money/money";

/** The minimum a creator must carry to be placed in a ranking. */
export type RankableCreator = {
  readonly creatorId: string;
  readonly amountCents: MoneyCents;
  /** `null` only when the creator has no counted contributions. */
  readonly reachedCurrentScoreAt: Date | null;
  readonly creatorCreatedAt: Date;
};

export type Ranked<TCreator extends RankableCreator> = TCreator & { readonly rank: number };

function compareTimestamps(a: Date | null, b: Date | null): number {
  // A creator with no counted money has not "reached" anything; sort them last
  // among equals so a real timestamp always wins the tiebreak.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.getTime() - b.getTime();
}

/**
 * Orders creators by the only ranking signal there is: money.
 *
 * 1. score, highest first
 * 2. who reached that score first
 * 3. who joined Creator Outdoor first
 *
 * The three keys form a total order, so ranks are always 1..n with no shared
 * positions. There is no secret algorithm, and no engagement signal
 * participates — impressions, clicks, CTR and every external platform metric
 * are deliberately absent from this module.
 */
export function rankCreators<TCreator extends RankableCreator>(
  creators: readonly TCreator[],
): Ranked<TCreator>[] {
  return [...creators]
    .sort((a, b) => {
      if (a.amountCents !== b.amountCents) {
        return b.amountCents - a.amountCents;
      }
      const byReachedAt = compareTimestamps(a.reachedCurrentScoreAt, b.reachedCurrentScoreAt);
      if (byReachedAt !== 0) {
        return byReachedAt;
      }
      const byCreatedAt = a.creatorCreatedAt.getTime() - b.creatorCreatedAt.getTime();
      if (byCreatedAt !== 0) {
        return byCreatedAt;
      }
      // Last resort so the order is deterministic even for identical fixtures.
      return a.creatorId.localeCompare(b.creatorId);
    })
    .map((creator, index) => ({ ...creator, rank: index + 1 }));
}

export const RANK_MOVEMENT_DIRECTIONS = ["UP", "DOWN", "NONE"] as const;
export type RankMovementDirection = (typeof RANK_MOVEMENT_DIRECTIONS)[number];

export type RankMovement = {
  /** `null` when the creator held no rank before (no counted money yet). */
  readonly fromRank: number | null;
  readonly toRank: number;
  /** Positions gained. Zero when the creator entered the ranking or did not move. */
  readonly positionsGained: number;
  readonly direction: RankMovementDirection;
};

/**
 * The movement a customer actually got.
 *
 * Always computed from the ranking after confirmation, never from the quote the
 * customer saw: the leaderboard may have changed while the PIX was pending, and
 * the success screen must show the real result.
 */
export function calculateRankMovement(fromRank: number | null, toRank: number): RankMovement {
  if (fromRank === null) {
    return { fromRank: null, toRank, positionsGained: 0, direction: "NONE" };
  }
  const positionsGained = fromRank - toRank;
  const direction: RankMovementDirection =
    positionsGained > 0 ? "UP" : positionsGained < 0 ? "DOWN" : "NONE";
  return { fromRank, toRank, positionsGained: Math.max(0, positionsGained), direction };
}
