import type { ProductConfig } from "@creator-outdoor/config";
import type { Database } from "@creator-outdoor/db";
import type { PixPaymentProvider } from "../payments/provider";
import type { PaymentEventOutcome } from "./payment-transitions";
import { recordOvertakes } from "./rank-events";
import { recomputeClosedPeriodFor } from "./rollover";

export type AppliedPaymentOutcome = Extract<PaymentEventOutcome, { readonly kind: "APPLIED" }>;

export type PaymentFollowUpDependencies = {
  readonly database: Database;
  readonly product: ProductConfig;
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
    await attempt("rank_event_failed", () =>
      recordOvertakes(dependencies.database, dependencies.product, {
        creatorId: outcome.creatorId,
        boostAmountCents: outcome.amountCents,
        now,
      }),
    );
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
    // The creator stopped being eligible while the payment was in flight, so the
    // promotion was never delivered and the money goes back. A failure here is
    // retried by the next reconciliation run; the boost is already VOID either way.
    await attempt("refund_failed", () => provider.refundPayment(outcome.providerPaymentId));
  }
}

async function attempt(label: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(label, { message: error instanceof Error ? error.message : "unknown" });
  }
}
