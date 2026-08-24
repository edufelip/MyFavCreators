import { createHash } from "node:crypto";
import type { ProductConfig } from "@creator-outdoor/config";
import {
  claimPaymentEvent,
  type Database,
  lockPaymentByProviderId,
  updateBoostStatus,
  updatePaymentStatus,
  withTransaction,
  writeAuditLog,
} from "@creator-outdoor/db";
import {
  assertPaymentTransition,
  boostStatusForPayment,
  calculateRotationWindow,
  canTransitionPayment,
  isPubliclyEligible,
  type PaymentStatus,
} from "@creator-outdoor/domain";
import type { ValidatedPaymentEvent } from "../payments/provider";

export type PaymentEventOutcome =
  | {
      readonly kind: "APPLIED";
      readonly from: PaymentStatus;
      readonly to: PaymentStatus;
      readonly boostActivated: boolean;
      readonly refundRequired: boolean;
      readonly providerPaymentId: string;
    }
  | { readonly kind: "DUPLICATE"; readonly providerPaymentId: string }
  | {
      readonly kind: "ILLEGAL_TRANSITION";
      readonly from: PaymentStatus;
      readonly to: PaymentStatus;
    }
  | { readonly kind: "UNKNOWN_PAYMENT"; readonly providerPaymentId: string };

/** Separator that cannot appear inside any of the joined values. */
const FINGERPRINT_SEPARATOR = "\u0000";

/**
 * The identity of a provider event.
 *
 * Built from the provider, the payment, the provider's own event id when it has
 * one, and the target status. A provider that reuses event ids across payments,
 * or omits them entirely, still yields a stable and distinct fingerprint.
 */
export function deriveEventFingerprint(provider: string, event: ValidatedPaymentEvent): string {
  return createHash("sha256")
    .update(
      [provider, event.providerPaymentId, event.providerEventId, event.status].join(
        FINGERPRINT_SEPARATOR,
      ),
    )
    .digest("hex");
}

export type ApplyPaymentEventInput = {
  readonly provider: string;
  readonly event: ValidatedPaymentEvent;
  readonly now: Date;
};

/**
 * Applies one provider event to one payment, exactly once.
 *
 * Everything that must agree commits together, in a single transaction, with the
 * payment row locked for its duration:
 *
 *  1. lock the payment, so two simultaneous deliveries serialise
 *  2. claim the event fingerprint; losing that claim means this event was
 *     already processed, and the correct answer is to acknowledge and stop
 *  3. check the transition against the payment state machine
 *  4. move the payment, move the boost to the status the payment implies, and
 *     on confirmation stamp the rotation window
 *  5. on confirmation, refuse to activate a boost for a creator who has become
 *     ineligible — the boost is voided and a refund is flagged instead
 *
 * The ranking needs no update here: it is derived from ACTIVE boosts with
 * CONFIRMED payments, so committing this transaction *is* the ranking change.
 */
export async function applyPaymentEvent(
  database: Database,
  product: ProductConfig,
  input: ApplyPaymentEventInput,
): Promise<PaymentEventOutcome> {
  const fingerprint = deriveEventFingerprint(input.provider, input.event);

  return withTransaction(database, async (tx): Promise<PaymentEventOutcome> => {
    const payment = await lockPaymentByProviderId(
      tx,
      input.provider,
      input.event.providerPaymentId,
    );
    if (payment === null) {
      return { kind: "UNKNOWN_PAYMENT", providerPaymentId: input.event.providerPaymentId };
    }

    const claimed = await claimPaymentEvent(tx, {
      paymentId: payment.paymentId,
      providerEventId: input.event.providerEventId,
      eventFingerprint: fingerprint,
      fromStatus: payment.paymentStatus,
      toStatus: input.event.status,
      payload: input.event.rawPayload,
    });
    if (!claimed) {
      // A replay. Acknowledged, never reprocessed: no second activation, no
      // second score change, no second notification.
      return { kind: "DUPLICATE", providerPaymentId: input.event.providerPaymentId };
    }

    if (!canTransitionPayment(payment.paymentStatus, input.event.status)) {
      // The event is recorded — it is a fact about what the provider sent — but
      // it moves nothing. An out-of-order PENDING after CONFIRMED lands here.
      return { kind: "ILLEGAL_TRANSITION", from: payment.paymentStatus, to: input.event.status };
    }
    assertPaymentTransition(payment.paymentStatus, input.event.status);

    const confirming = input.event.status === "CONFIRMED";
    const creatorEligible = isPubliclyEligible(payment.creatorModerationStatus);
    const activate = confirming && creatorEligible;

    await updatePaymentStatus(tx, {
      paymentId: payment.paymentId,
      status: input.event.status,
      at: input.now,
      ...(confirming ? { confirmedAt: input.event.occurredAt ?? input.now } : {}),
      ...(input.event.status === "REFUNDED" ? { refundedAt: input.now } : {}),
    });

    await applyBoostSideEffect(tx, product, {
      payment,
      event: input.event,
      provider: input.provider,
      now: input.now,
      activate,
      confirming,
    });

    if (input.event.status === "REFUNDED") {
      await writeAuditLog(tx, {
        actor: `provider:${input.provider}`,
        action: "payment.refunded",
        targetType: "payment",
        targetId: payment.paymentId,
        metadata: {
          boostId: payment.boostId,
          creatorId: payment.creatorId,
          amountCents: payment.amountCents,
        },
      });
    }

    return {
      kind: "APPLIED",
      from: payment.paymentStatus,
      to: input.event.status,
      boostActivated: activate,
      refundRequired: confirming && !creatorEligible,
      providerPaymentId: input.event.providerPaymentId,
    };
  });
}

type BoostSideEffectInput = {
  readonly payment: Awaited<ReturnType<typeof lockPaymentByProviderId>> & object;
  readonly event: ValidatedPaymentEvent;
  readonly provider: string;
  readonly now: Date;
  readonly activate: boolean;
  readonly confirming: boolean;
};

/**
 * Moves the boost to the status this payment event implies.
 *
 * Three outcomes, in the same transaction as the payment change:
 * the promotion goes live, the money arrived for a creator who may no longer
 * appear publicly (so nothing is delivered and a refund is owed), or the boost
 * simply follows its payment.
 */
async function applyBoostSideEffect(
  tx: Parameters<typeof updateBoostStatus>[0],
  product: ProductConfig,
  input: BoostSideEffectInput,
): Promise<void> {
  const { payment, event, now } = input;

  if (input.activate) {
    const confirmedAt = event.occurredAt ?? now;
    const rotation = calculateRotationWindow(confirmedAt, product.rotationHours);
    await updateBoostStatus(tx, {
      boostId: payment.boostId,
      status: "ACTIVE",
      confirmedAt,
      rotationStartsAt: rotation.rotationStartsAt,
      rotationEndsAt: rotation.rotationEndsAt,
      at: now,
    });
    return;
  }

  if (input.confirming) {
    await updateBoostStatus(tx, {
      boostId: payment.boostId,
      status: "VOID",
      confirmedAt: null,
      at: now,
    });
    await writeAuditLog(tx, {
      actor: `provider:${input.provider}`,
      action: "boost.voided_ineligible_creator",
      targetType: "boost",
      targetId: payment.boostId,
      metadata: {
        creatorId: payment.creatorId,
        moderationStatus: payment.creatorModerationStatus,
        paymentId: payment.paymentId,
      },
    });
    return;
  }

  const boostStatus = boostStatusForPayment(event.status);
  if (boostStatus !== payment.boostStatus) {
    await updateBoostStatus(tx, { boostId: payment.boostId, status: boostStatus, at: now });
  }
}
