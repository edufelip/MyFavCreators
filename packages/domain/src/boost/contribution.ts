import { isRankablePaymentStatus, type PaymentStatus } from "../payment/status";
import { type BoostStatus, isRankableBoostStatus } from "./status";

export type RankingContributionInput = {
  readonly boostStatus: BoostStatus;
  readonly paymentStatus: PaymentStatus;
};

/**
 * The single rule that decides whether money counts toward a ranking.
 *
 * Money is the only ranking signal, and only an ACTIVE boost backed by a
 * CONFIRMED payment counts. Pending, failed, expired, cancelled and refunded
 * payments never rank, and neither do VOID or REVERSED boosts.
 */
export function contributesToRanking(input: RankingContributionInput): boolean {
  return isRankableBoostStatus(input.boostStatus) && isRankablePaymentStatus(input.paymentStatus);
}
