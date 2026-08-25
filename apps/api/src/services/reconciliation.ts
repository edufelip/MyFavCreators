import type { ProductConfig } from "@creator-outdoor/config";
import { type Database, listOwedRefunds, listUnsettledPayments } from "@creator-outdoor/db";
import { isTerminalPaymentStatus } from "@creator-outdoor/domain";
import type { EmailProvider } from "../email/provider";
import { log } from "../observability/logger";
import { PaymentProviderError, type PixPaymentProvider } from "../payments/provider";
import { runPaymentFollowUps } from "./payment-follow-ups";
import { applyPaymentEvent, type PaymentEventOutcome } from "./payment-transitions";

export type ReconciliationSummary = {
  readonly examined: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly failed: number;
  /** Refunds the platform owed and has now actually made. */
  readonly refunded: number;
};

export type ReconcileOptions = {
  readonly now: Date;
  /** Only look at payments untouched for at least this long. */
  readonly staleAfterMinutes?: number;
  readonly limit?: number;
  /** How many owed refunds to work through in one run. */
  readonly refundLimit?: number;
  /** Absent in a process that does not send mail; notifications are skipped. */
  readonly email?: EmailProvider;
  readonly webOrigin?: string;
};

/**
 * Brings stuck payments back in line with the provider.
 *
 * Webhooks get lost. A delivery times out, a deploy drops one, a provider has an
 * incident — and a customer who really paid is left looking at a spinner while
 * their money sits confirmed on the provider's side.
 *
 * This asks the provider about every payment still `CREATED` or `PENDING` and
 * feeds the answer through **the same transition service the webhook uses**, then
 * through **the same follow-ups**. There is deliberately no second payment state
 * machine and no second set of consequences: a recovered payment produces the
 * ticker line, the corrected history and the refund a delivered one would have,
 * and its writes are idempotent for exactly the same reason — the event
 * fingerprint is unique, so an answer a webhook already delivered is recognised
 * as a duplicate and changes nothing.
 */
export async function reconcilePayments(
  database: Database,
  product: ProductConfig,
  provider: PixPaymentProvider,
  options: ReconcileOptions,
): Promise<ReconciliationSummary> {
  const staleAfterMinutes = options.staleAfterMinutes ?? 5;
  const olderThan = new Date(options.now.getTime() - staleAfterMinutes * 60_000);
  const candidates = await listUnsettledPayments(
    database,
    provider.name,
    olderThan,
    options.limit ?? 200,
  );

  let changed = 0;
  let unchanged = 0;
  let failed = 0;

  for (const candidate of candidates) {
    let outcome: PaymentEventOutcome;
    try {
      const status = await provider.getPaymentStatus(candidate.providerPaymentId);
      if (status === candidate.status) {
        unchanged += 1;
        continue;
      }

      outcome = await applyPaymentEvent(database, product, {
        provider: provider.name,
        event: {
          // A synthesized event id, stable for this payment and status, so a
          // reconciliation repeated an hour later is still a duplicate rather
          // than a second application.
          providerEventId: `reconcile:${status}`,
          providerPaymentId: candidate.providerPaymentId,
          status,
          occurredAt: options.now,
          rawPayload: { source: "reconciliation", status },
        },
        now: options.now,
      });
    } catch (error) {
      failed += 1;
      log.error("reconciliation_failed", error, {
        provider: provider.name,
        recoverable: !(error instanceof PaymentProviderError),
      });
      continue;
    }

    if (outcome.kind === "APPLIED") {
      changed += 1;
      await runPaymentFollowUps(
        {
          database,
          product,
          ...(options.email === undefined ? {} : { email: options.email }),
          ...(options.webOrigin === undefined ? {} : { webOrigin: options.webOrigin }),
        },
        provider,
        outcome,
        options.now,
      );
      log.info("reconciliation_applied", {
        provider: provider.name,
        from: outcome.from,
        to: outcome.to,
        boostActivated: outcome.boostActivated,
        terminal: isTerminalPaymentStatus(outcome.to),
      });
    } else {
      unchanged += 1;
    }
  }

  const refunds = await settleOwedRefunds(database, product, provider, options);

  return {
    examined: candidates.length + refunds.examined,
    changed,
    unchanged,
    failed: failed + refunds.failed,
    refunded: refunds.refunded,
  };
}

/**
 * Pays back money the platform owes and still holds.
 *
 * A boost voided for an ineligible creator flags a refund, and the webhook path
 * issues it immediately — but that call can fail, and when it does the money
 * stays with a payment that is `CONFIRMED`. The unsettled sweep above will
 * never look at it, because it is not unsettled. Without this, "a refund was
 * flagged" is the last thing that ever happens to it.
 *
 * The provider is asked first. A refund it has already made is recorded rather
 * than requested again, which is what makes a crash between the call and the
 * write recoverable instead of a double refund.
 *
 * Two runs overlapping is a different case, and the ask-first check does not
 * cover it: both can read CONFIRMED and both can call. What stops the second
 * call from moving money twice is the provider's own idempotency — the adapter
 * sends a key derived from the payment, so the provider recognises the repeat.
 * `PixPaymentProvider.refundPayment` therefore has to be idempotent per payment,
 * and an adapter that is not would double-refund here. The unique event
 * fingerprint still keeps our own record straight either way: one run applies,
 * the other is a duplicate.
 */
async function settleOwedRefunds(
  database: Database,
  product: ProductConfig,
  provider: PixPaymentProvider,
  options: ReconcileOptions,
): Promise<{ readonly examined: number; readonly refunded: number; readonly failed: number }> {
  const limit = options.refundLimit ?? 100;
  // One more than the limit, so "there are more" is something this run knows
  // rather than something it infers from having filled its own quota.
  const found = await listOwedRefunds(database, provider.name, limit + 1);
  const owed = found.slice(0, limit);

  let refunded = 0;
  let failed = 0;

  for (const candidate of owed) {
    try {
      const status = await provider.getPaymentStatus(candidate.providerPaymentId);
      if (status !== "REFUNDED") {
        await provider.refundPayment(candidate.providerPaymentId);
      }

      const outcome = await applyPaymentEvent(database, product, {
        provider: provider.name,
        event: {
          // Stable for this payment, so recording it twice is a duplicate
          // rather than a second refund.
          providerEventId: "reconcile:owed-refund",
          providerPaymentId: candidate.providerPaymentId,
          status: "REFUNDED",
          occurredAt: options.now,
          rawPayload: { source: "reconciliation", reason: "owed-refund" },
        },
        now: options.now,
      });

      if (outcome.kind === "APPLIED") {
        refunded += 1;
        await runPaymentFollowUps(
          {
            database,
            product,
            ...(options.email === undefined ? {} : { email: options.email }),
            ...(options.webOrigin === undefined ? {} : { webOrigin: options.webOrigin }),
          },
          provider,
          outcome,
          options.now,
        );
        log.info("owed_refund_settled", {
          provider: provider.name,
          creatorId: candidate.creatorId,
        });
      }
    } catch (error) {
      failed += 1;
      // Still owed, so the next run tries again. Money is never written off by
      // a failed attempt.
      log.error("owed_refund_failed", error, {
        provider: provider.name,
        creatorId: candidate.creatorId,
      });
    }
  }

  if (found.length > limit) {
    // Deliberately loud, and deliberately specific: money is still owed that
    // this run did not reach. An operator seeing this repeatedly needs to know
    // the sweep is falling behind, not just that it hit its own cap.
    log.warn("owed_refunds_truncated", {
      provider: provider.name,
      limit,
      settled: refunded,
      failed,
      atLeastRemaining: found.length - limit,
    });
  }

  return { examined: owed.length, refunded, failed };
}
