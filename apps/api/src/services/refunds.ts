import type { ProductConfig } from "@creator-outdoor/config";
import { type Database, findAdminPayment, writeAuditLog } from "@creator-outdoor/db";
import type { EmailProvider } from "../email/provider";
import { log } from "../observability/logger";
import type { PixPaymentProvider } from "../payments/provider";
import { runPaymentFollowUps } from "./payment-follow-ups";
import { applyPaymentEvent } from "./payment-transitions";

export type RefundRequest = {
  readonly paymentId: string;
  readonly actor: string;
  readonly reason: string;
  readonly now: Date;
  readonly email?: EmailProvider;
  readonly webOrigin?: string;
};

export type RefundOutcome =
  | { readonly kind: "REFUNDED" }
  /** Already refunded. Saying so is not a failure — the money is back either way. */
  | { readonly kind: "ALREADY_REFUNDED" }
  | { readonly kind: "NOT_FOUND" }
  | { readonly kind: "NOT_REFUNDABLE"; readonly status: string }
  | { readonly kind: "WRONG_PROVIDER"; readonly provider: string }
  /** The provider was never asked to move anything. Nothing changed. */
  | { readonly kind: "PROVIDER_UNREACHABLE" }
  /**
   * The instruction was sent and the answer never came back.
   *
   * Deliberately distinct from the case above, and the distinction is the whole
   * point: a timeout after the provider accepted a refund looks identical from
   * here to one before it did. Reporting "nothing changed" would be a guess
   * stated as a fact about money, so this says what is actually known — that it
   * has to be checked — and the sweep is left something it can find.
   */
  | { readonly kind: "REFUND_UNCERTAIN" };

/**
 * Sends a confirmed payment back, on an operator's instruction.
 *
 * A support conversation reaches a point no automatic rule covers — a duplicate
 * PIX, a mistaken purchase, a promotion nobody could see because of an incident
 * on our side. Somebody has to be able to give the money back, and until now
 * nobody could: the only refunds that existed were the ones the platform decided
 * on by itself.
 *
 * This deliberately shares the machinery the automatic path uses rather than
 * repeating it. The provider is asked first, so a refund already made is
 * recorded rather than requested twice; the change goes through the same
 * transition service, so the same fingerprint makes a repeated instruction a
 * duplicate instead of a second refund; and the same follow-ups run, so the
 * ticker, the history and the boost end up exactly where an automatic refund
 * would have left them.
 *
 * No money moves toward a creator here or anywhere else. A refund unsells
 * prominence and returns the money to the person who bought it.
 */
export async function refundPaymentOnRequest(
  database: Database,
  product: ProductConfig,
  provider: PixPaymentProvider,
  request: RefundRequest,
): Promise<RefundOutcome> {
  const payment = await findAdminPayment(database, request.paymentId);
  if (payment === null) {
    return { kind: "NOT_FOUND" };
  }
  if (payment.provider !== provider.name) {
    // A payment taken by another provider cannot be refunded through this one,
    // and guessing would send a real instruction about a real payment to the
    // wrong place.
    return { kind: "WRONG_PROVIDER", provider: payment.provider };
  }
  if (payment.status === "REFUNDED") {
    return { kind: "ALREADY_REFUNDED" };
  }
  if (payment.status !== "CONFIRMED") {
    // Nothing to send back: the money either never arrived or never will.
    return { kind: "NOT_REFUNDABLE", status: payment.status };
  }

  // Asking and instructing are separated, because failing at one means
  // something different from failing at the other.
  let alreadyRefunded: boolean;
  try {
    alreadyRefunded = (await provider.getPaymentStatus(payment.providerPaymentId)) === "REFUNDED";
  } catch (error) {
    log.error("admin_refund_provider_unreachable", error, { provider: provider.name });
    await writeAuditLog(database, {
      actor: request.actor,
      action: "payment.refund_not_attempted",
      targetType: "payment",
      targetId: payment.id,
      metadata: { reason: request.reason, provider: payment.provider },
    });
    return { kind: "PROVIDER_UNREACHABLE" };
  }

  if (!alreadyRefunded) {
    /*
     * The marker goes down *before* the instruction goes out, not after it
     * fails. Written afterwards, it covered only the failures we saw: a
     * `refundPayment` that succeeded and an `applyPaymentEvent` that then threw
     * — a failover, a pool timeout, a lock wait behind a webhook — left the
     * money gone, the payment CONFIRMED, the boost still scoring, and no record
     * anywhere that anything had been attempted. The sweep looks for this
     * marker, so writing it first means every state in which money can have
     * moved is findable. Recording an intent that turns out not to have moved
     * anything costs one provider query on the next sweep.
     */
    await writeAuditLog(database, {
      actor: request.actor,
      action: "payment.refund_uncertain",
      targetType: "payment",
      targetId: payment.id,
      metadata: { reason: request.reason, provider: payment.provider, stage: "attempting" },
    });

    try {
      await provider.refundPayment(payment.providerPaymentId);
    } catch (error) {
      /*
       * The instruction went out. Whether it landed is unknown, and guessing
       * either way is worse than saying so: told "nothing changed", an operator
       * refunds again; told "done", they close the ticket on money that may
       * still be here. The boost is left alone for the same reason — its
       * position is only wrong if the refund actually happened.
       */
      log.error("admin_refund_uncertain", error, { provider: provider.name });
      return { kind: "REFUND_UNCERTAIN" };
    }
  }

  const outcome = await applyPaymentEvent(database, product, {
    provider: provider.name,
    event: {
      // Stable for this payment, so a double-clicked button or a retried
      // request is recognised as the same instruction rather than a second one.
      providerEventId: "admin:refund",
      providerPaymentId: payment.providerPaymentId,
      status: "REFUNDED",
      occurredAt: request.now,
      rawPayload: { source: "admin", reason: request.reason },
    },
    now: request.now,
  });

  // A distinct action from the `payment.refunded` the transition service writes.
  // That one records that the money went back; this one records who decided it
  // should and why — two different facts, and the second is the one no later
  // reader could reconstruct.
  await writeAuditLog(database, {
    actor: request.actor,
    action: "payment.refunded_by_operator",
    targetType: "payment",
    targetId: payment.id,
    metadata: {
      reason: request.reason,
      amountCents: payment.amountCents,
      creatorId: payment.creatorId,
      applied: outcome.kind === "APPLIED",
    },
  });

  if (outcome.kind === "DUPLICATE") {
    // Somebody already recorded this exact instruction. The provider has the
    // money back and the record says so; a second click is not a second refund.
    return { kind: "ALREADY_REFUNDED" };
  }
  if (outcome.kind !== "APPLIED") {
    /*
     * An illegal transition or an unknown payment, which cannot happen from
     * here: the payment was read as CONFIRMED a moment ago, CONFIRMED can only
     * become REFUNDED, and the lock re-finds the same row. Reporting it as
     * "already refunded" would be a guess that happens to be true today and
     * would quietly become a lie the day a status is added.
     */
    log.error("admin_refund_unexpected_outcome", new Error(outcome.kind), {
      provider: provider.name,
    });
    throw new Error(`Refund reached an unexpected outcome: ${outcome.kind}`);
  }

  await runPaymentFollowUps(
    {
      database,
      product,
      ...(request.email === undefined ? {} : { email: request.email }),
      ...(request.webOrigin === undefined ? {} : { webOrigin: request.webOrigin }),
    },
    provider,
    outcome,
    request.now,
  );

  log.info("admin_refund_applied", {
    provider: provider.name,
    actor: request.actor,
    amountCents: payment.amountCents,
  });
  return { kind: "REFUNDED" };
}
