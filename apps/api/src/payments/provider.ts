import type { PaymentStatus } from "@creator-outdoor/domain";

/**
 * A validated event from a payment provider.
 *
 * `providerEventId` is the provider's own identifier for the event when it has
 * one. Where it does not, the transition service derives a fingerprint from the
 * payload instead — either way the fingerprint is what the database enforces
 * uniqueness on, which is what makes a replayed webhook harmless.
 */
export type ValidatedPaymentEvent = {
  readonly providerEventId: string;
  readonly providerPaymentId: string;
  readonly status: PaymentStatus;
  readonly occurredAt?: Date;
  readonly rawPayload: unknown;
};

export type CreatePixPaymentInput = {
  readonly amountCents: number;
  /** Our own reference, echoed back by the provider so events can be matched. */
  readonly externalRef: string;
};

export type CreatedPixPayment = {
  readonly providerPaymentId: string;
  /** The QR payload, rendered as an image by the client. */
  readonly qrCode: string;
  readonly copyPaste: string;
  readonly expiresAt: Date;
};

/**
 * Everything Creator Outdoor needs from a PIX provider.
 *
 * Domain logic never depends on a provider SDK: the interface lives here in the
 * API's infrastructure layer, and swapping providers means writing one adapter,
 * not touching the ranking, the boost lifecycle, or the payment state machine.
 */
export interface PixPaymentProvider {
  readonly name: string;
  createPixPayment(input: CreatePixPaymentInput): Promise<CreatedPixPayment>;
  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus>;
  /**
   * Authenticates and normalizes an incoming webhook.
   *
   * Throws when the request is not genuinely from the provider. A spoofed or
   * tampered request must never reach the transition service.
   */
  validateWebhook(request: Request): Promise<ValidatedPaymentEvent>;
  refundPayment(providerPaymentId: string): Promise<void>;
}

export class WebhookValidationError extends Error {
  override readonly name = "WebhookValidationError";
}

export class PaymentProviderError extends Error {
  override readonly name = "PaymentProviderError";
}
