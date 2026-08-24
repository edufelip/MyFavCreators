import { type MoneyCents, sumCents, ZERO_CENTS } from "../money/money";

/**
 * One boost that currently counts toward a creator's score.
 *
 * "Currently counts" is the important part: a contribution disappears from this
 * list the moment its boost is reversed or its payment is refunded.
 */
export type ScoreContribution = {
  readonly amountCents: MoneyCents;
  readonly confirmedAt: Date;
};

/**
 * The instant a creator reached the score they hold right now.
 *
 * R$50 at 10:00 plus R$50 at 11:00 is R$100 reached at 11:00. If the 11:00 boost
 * is later refunded the score falls back to R$50 reached at 10:00 — the refund
 * time is never the time the lower score was reached, because the value is
 * derived from the contributions that survive rather than from mutable state.
 *
 * Returns `null` for a creator with no counted contributions.
 */
export function deriveCurrentScoreReachedAt(
  contributions: readonly ScoreContribution[],
): Date | null {
  let latest: number | null = null;
  for (const contribution of contributions) {
    const time = contribution.confirmedAt.getTime();
    if (latest === null || time > latest) {
      latest = time;
    }
  }
  return latest === null ? null : new Date(latest);
}

export function deriveCurrentScore(contributions: readonly ScoreContribution[]): MoneyCents {
  return contributions.length === 0
    ? ZERO_CENTS
    : sumCents(contributions.map((contribution) => contribution.amountCents));
}
