import type { ProductConfig } from "@creator-outdoor/config";
import type { Database } from "@creator-outdoor/db";
import type { EmailProvider } from "../email/provider";
import { log } from "../observability/logger";
import type { PixPaymentProvider } from "../payments/provider";
import {
  consentedNotificationTypes,
  notifyDethrone,
  subscribeToNotifications,
} from "./notifications";
import type { PaymentEventOutcome } from "./payment-transitions";
import { detectLeaderChange, recordOvertakes } from "./rank-events";
import { recomputeClosedPeriodFor } from "./rollover";

export type AppliedPaymentOutcome = Extract<PaymentEventOutcome, { readonly kind: "APPLIED" }>;

export type PaymentFollowUpDependencies = {
  readonly database: Database;
  readonly product: ProductConfig;
  /** Absent in a process that does not send mail; notifications are skipped. */
  readonly email?: EmailProvider;
  readonly webOrigin?: string;
};

/**
 * Everything that happens *after* the payment transaction committed.
 *
 * There is one of these, shared by every path that can apply a payment event —
 * the webhook and reconciliation both call it. A payment recovered by the job
 * therefore has exactly the same public consequences as one whose webhook
 * arrived: the same ticker line, the same corrected history, the same refund.
 * Two copies of this logic would mean a lost webhook quietly costing a creator
 * their overtake, or a customer their money back.
 *
 * Each step is secondary to a correct payment, so each is attempted
 * independently and each failure is logged rather than thrown: a ticker line, a
 * historical snapshot or a refund call must never undo an activation or make the
 * provider retry a delivery that already succeeded.
 */
export async function runPaymentFollowUps(
  dependencies: PaymentFollowUpDependencies,
  provider: PixPaymentProvider,
  outcome: AppliedPaymentOutcome,
  now: Date,
): Promise<void> {
  if (outcome.boostActivated) {
    /*
     * Whatever the payer agreed to is recorded before anything else can fail:
     * an interest lost because a ticker write threw would be silent and
     * permanent. Nothing is recorded for a notification nobody asked for.
     */
    await attempt("subscription_failed", () =>
      subscribeToNotifications(dependencies.database, {
        email: outcome.supporterEmail,
        creatorId: outcome.creatorId,
        types: consentedNotificationTypes(outcome),
      }),
    );

    /*
     * The ticker and the notification are answered separately and in this
     * order: the ticker describes the mover's climb, while the notification is
     * about the leader losing the top spot, and a newcomer who buys #1 outright
     * produces the second without producing the first.
     */
    const change = await attemptValue("leader_change_failed", () =>
      detectLeaderChange(dependencies.database, dependencies.product, {
        creatorId: outcome.creatorId,
        boostAmountCents: outcome.amountCents,
        now,
      }),
    );

    await attempt("rank_event_failed", () =>
      recordOvertakes(dependencies.database, dependencies.product, {
        creatorId: outcome.creatorId,
        boostAmountCents: outcome.amountCents,
        now,
      }),
    );

    const email = dependencies.email;
    const webOrigin = dependencies.webOrigin;
    if (change !== null && email !== undefined && webOrigin !== undefined) {
      await attempt("dethrone_notification_failed", () =>
        notifyDethrone(
          { database: dependencies.database, product: dependencies.product, email, webOrigin },
          change,
          // One notification per activation: a redelivered webhook or a
          // reconciliation pass for the same payment claims the same key.
          `dethrone:${provider.name}:${outcome.providerPaymentId}`,
        ),
      );
    }
  }

  if (outcome.to === "REFUNDED" && outcome.confirmedAt !== null) {
    // A refund can land after the period closed. Hall da Fama has to show
    // financially active boosts, so that period is recomputed.
    const confirmedAt = outcome.confirmedAt;
    await attempt("snapshot_correction_failed", () =>
      recomputeClosedPeriodFor(dependencies.database, dependencies.product, confirmedAt, now),
    );
  }

  if (outcome.refundRequired) {
    /*
     * The creator stopped being eligible while the payment was in flight, so
     * the promotion was never delivered and the money goes back. The boost is
     * already VOID either way.
     *
     * A failure here is picked up by `settleOwedRefunds`, which finds exactly
     * this shape — a CONFIRMED payment behind a VOID boost with no refund
     * recorded — and tries again. That sweep exists because this comment used
     * to promise a retry that nothing performed: the payment is CONFIRMED, so
     * the unsettled sweep never looked at it, and the money stayed with us.
     */
    await attempt("refund_failed", () => provider.refundPayment(outcome.providerPaymentId));
  }
}

async function attempt(label: string, work: () => Promise<unknown>): Promise<void> {
  await attemptValue(label, work);
}

/** Same contract, but hands back what the step produced when it succeeded. */
async function attemptValue<TValue>(
  label: string,
  work: () => Promise<TValue>,
): Promise<TValue | null> {
  try {
    return await work();
  } catch (error) {
    log.error(label, error);
    return null;
  }
}
