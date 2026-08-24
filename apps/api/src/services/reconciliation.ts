import type { ProductConfig } from "@creator-outdoor/config";
import { type Database, listUnsettledPayments } from "@creator-outdoor/db";
import { isTerminalPaymentStatus } from "@creator-outdoor/domain";
import type { EmailProvider } from "../email/provider";
import { describeErrorMessage } from "../observability/errors";
import { PaymentProviderError, type PixPaymentProvider } from "../payments/provider";
import { runPaymentFollowUps } from "./payment-follow-ups";
import { applyPaymentEvent, type PaymentEventOutcome } from "./payment-transitions";

export type ReconciliationSummary = {
  readonly examined: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly failed: number;
};

export type ReconcileOptions = {
  readonly now: Date;
  /** Only look at payments untouched for at least this long. */
  readonly staleAfterMinutes?: number;
  readonly limit?: number;
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
      console.error("reconciliation_failed", {
        provider: provider.name,
        message: describeErrorMessage(error),
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
      console.info("reconciliation_applied", {
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

  return { examined: candidates.length, changed, unchanged, failed };
}
