import type { PaymentStatus } from "./status";

/**
 * The payment lifecycle.
 *
 * Payment state is the one thing in Creator Outdoor that must never be
 * eventually consistent, so no code anywhere writes a status directly: every
 * change is checked against this table first. That is what makes a replayed or
 * out-of-order provider event harmless — a duplicate CONFIRMED is not a legal
 * move from CONFIRMED, so it cannot activate a boost twice.
 *
 * A settled payment is nearly final: CONFIRMED can only be refunded, and
 * FAILED, EXPIRED, CANCELLED and REFUNDED accept nothing at all. Money that
 * failed can never quietly become money that counts.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  CREATED: ["PENDING", "CONFIRMED", "FAILED", "EXPIRED", "CANCELLED"],
  PENDING: ["CONFIRMED", "FAILED", "EXPIRED", "CANCELLED"],
  CONFIRMED: ["REFUNDED"],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function allowedPaymentTransitions(from: PaymentStatus): readonly PaymentStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export class InvalidPaymentTransitionError extends Error {
  override readonly name = "InvalidPaymentTransitionError";

  constructor(
    readonly from: PaymentStatus,
    readonly to: PaymentStatus,
  ) {
    super(`A payment cannot move from ${from} to ${to}`);
  }
}

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransitionPayment(from, to)) {
    throw new InvalidPaymentTransitionError(from, to);
  }
}

/** The money reached a final answer, one way or the other. */
export function isSettledPaymentStatus(status: PaymentStatus): boolean {
  return status === "CONFIRMED" || status === "REFUNDED";
}

/** Nothing more can happen to this payment. */
export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}
