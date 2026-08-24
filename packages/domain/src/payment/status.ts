export const PAYMENT_STATUSES = [
  "CREATED",
  "PENDING",
  "CONFIRMED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  "REFUNDED",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === "string" && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

/** Only settled money ranks. */
export function isRankablePaymentStatus(status: PaymentStatus): boolean {
  return status === "CONFIRMED";
}
