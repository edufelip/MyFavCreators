import type { PaymentStatus } from "../payment/status";
import type { BoostStatus } from "./status";

/**
 * The boost lifecycle, which mirrors what actually happened to the money.
 *
 * PENDING  the payment has not settled, so no promotion was delivered
 * ACTIVE   the payment confirmed and the promotion is live
 * VOID     the promotion never activated, because the money never settled
 * REVERSED the promotion was live and was later undone by a refund
 *
 * VOID and REVERSED are terminal: a promotion that never happened cannot start
 * later, and one that was undone cannot resume.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<BoostStatus, readonly BoostStatus[]>> = {
  PENDING: ["ACTIVE", "VOID"],
  ACTIVE: ["REVERSED"],
  VOID: [],
  REVERSED: [],
};

export function canTransitionBoost(from: BoostStatus, to: BoostStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function allowedBoostTransitions(from: BoostStatus): readonly BoostStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export class InvalidBoostTransitionError extends Error {
  override readonly name = "InvalidBoostTransitionError";

  constructor(
    readonly from: BoostStatus,
    readonly to: BoostStatus,
  ) {
    super(`A boost cannot move from ${from} to ${to}`);
  }
}

export function assertBoostTransition(from: BoostStatus, to: BoostStatus): void {
  if (!canTransitionBoost(from, to)) {
    throw new InvalidBoostTransitionError(from, to);
  }
}

/**
 * The boost status a payment status implies.
 *
 * There is exactly one right answer for each, which keeps the two lifecycles
 * from drifting apart: a boost is never activated by anything except its own
 * payment confirming.
 */
export function boostStatusForPayment(paymentStatus: PaymentStatus): BoostStatus {
  switch (paymentStatus) {
    case "CREATED":
    case "PENDING":
      return "PENDING";
    case "CONFIRMED":
      return "ACTIVE";
    case "FAILED":
    case "EXPIRED":
    case "CANCELLED":
      return "VOID";
    case "REFUNDED":
      return "REVERSED";
  }
}
