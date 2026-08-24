import type { ProductConfig } from "@creator-outdoor/config";
import type { Database } from "@creator-outdoor/db";
import { Elysia, t } from "elysia";
import type { PixPaymentProvider } from "../payments/provider";
import { WebhookValidationError } from "../payments/provider";
import { applyPaymentEvent } from "../services/payment-transitions";
import { recordOvertakes } from "../services/rank-events";
import { recomputeClosedPeriodFor } from "../services/rollover";

export type WebhookRouteDependencies = {
  readonly database: Database;
  readonly product: ProductConfig;
  readonly providers: ReadonlyMap<string, PixPaymentProvider>;
  readonly now?: () => Date;
};

/**
 * Provider webhooks.
 *
 * The provider authenticates its own request through `validateWebhook`; a
 * request that fails that check never reaches the transition service, so a
 * forged call cannot move a payment. Everything past validation is idempotent
 * by database constraint, so a genuine delivery repeated ten times still
 * activates exactly one boost.
 *
 * A duplicate or an out-of-order event answers 200: the provider has nothing to
 * retry, and re-delivery would only produce the same no-op.
 */
export function webhookRoutes(dependencies: WebhookRouteDependencies) {
  const now = dependencies.now ?? (() => new Date());

  return new Elysia().post(
    "/v1/webhooks/payments/:provider",
    async ({ params, request, status }) => {
      const provider = dependencies.providers.get(params.provider);
      if (provider === undefined) {
        return status(404, { received: false, outcome: "UNKNOWN_PROVIDER" as const });
      }

      let event: Awaited<ReturnType<PixPaymentProvider["validateWebhook"]>>;
      try {
        event = await provider.validateWebhook(request);
      } catch (error) {
        if (error instanceof WebhookValidationError) {
          console.warn("webhook_rejected", { provider: params.provider, reason: error.message });
          return status(401, { received: false, outcome: "INVALID_SIGNATURE" as const });
        }
        throw error;
      }

      const outcome = await applyPaymentEvent(dependencies.database, dependencies.product, {
        provider: provider.name,
        event,
        now: now(),
      });

      if (outcome.kind === "APPLIED") {
        await runFollowUps(dependencies, provider, outcome, now());
      }

      return { received: true, outcome: outcome.kind };
    },
    {
      params: t.Object({ provider: t.String({ maxLength: 40 }) }),
      response: {
        200: t.Object({
          received: t.Literal(true),
          outcome: t.Union([
            t.Literal("APPLIED"),
            t.Literal("DUPLICATE"),
            t.Literal("ILLEGAL_TRANSITION"),
            t.Literal("UNKNOWN_PAYMENT"),
          ]),
        }),
        401: t.Object({
          received: t.Literal(false),
          outcome: t.Literal("INVALID_SIGNATURE"),
        }),
        404: t.Object({
          received: t.Literal(false),
          outcome: t.Literal("UNKNOWN_PROVIDER"),
        }),
      },
    },
  );
}

type AppliedOutcome = Extract<
  Awaited<ReturnType<typeof applyPaymentEvent>>,
  { readonly kind: "APPLIED" }
>;

/**
 * Everything that happens *after* the payment transaction committed.
 *
 * Each of these is secondary to a correct payment, so each is attempted
 * independently and each failure is logged rather than thrown: a ticker line, a
 * historical snapshot or a refund call must never undo an activation or make the
 * provider retry a delivery that already succeeded.
 */
async function runFollowUps(
  dependencies: WebhookRouteDependencies,
  provider: PixPaymentProvider,
  outcome: AppliedOutcome,
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
    // promotion was never delivered and the money goes back. Reconciliation
    // retries this; the boost is already VOID either way.
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
