import { type MoneyCents, maxCents, moneyCents, subtractCents } from "../money/money";

export type TakeFirstPlaceInput = {
  readonly leaderAmountCents: MoneyCents;
  readonly creatorAmountCents: MoneyCents;
  readonly minIncrementCents: MoneyCents;
  readonly minBoostCents: MoneyCents;
};

export type TargetRankQuoteInput = {
  readonly targetCreatorAmountCents: MoneyCents;
  readonly creatorAmountCents: MoneyCents;
  readonly minIncrementCents: MoneyCents;
  readonly minBoostCents: MoneyCents;
};

/**
 * The amount required to overtake a target score in the ranking.
 */
export function calculateOvertakeQuote(input: TargetRankQuoteInput): MoneyCents {
  const gap = subtractCents(input.targetCreatorAmountCents, input.creatorAmountCents);
  const required = moneyCents(gap + input.minIncrementCents);
  return maxCents(required, input.minBoostCents);
}

/**
 * The amount that would put a creator ahead of the current leader.
 *
 * The quote is a snapshot of the ranking at the moment it is calculated. It
 * reserves nothing: the leaderboard is free to move while a PIX is pending, the
 * customer is charged exactly this amount and never a centavo more, and the
 * resulting position is whatever the ranking says after confirmation.
 */
export function calculateTakeFirstPlace(input: TakeFirstPlaceInput): MoneyCents {
  return calculateOvertakeQuote({
    targetCreatorAmountCents: input.leaderAmountCents,
    creatorAmountCents: input.creatorAmountCents,
    minIncrementCents: input.minIncrementCents,
    minBoostCents: input.minBoostCents,
  });
}

export type TakeFirstPlaceQuoteInput = TakeFirstPlaceInput & { readonly isCurrentLeader: boolean };

/**
 * The quote as the leaderboard renders it: hidden for the creator already at #1.
 */
export function takeFirstPlaceQuote(input: TakeFirstPlaceQuoteInput): MoneyCents | null {
  return input.isCurrentLeader ? null : calculateTakeFirstPlace(input);
}
