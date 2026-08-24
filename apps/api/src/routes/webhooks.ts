import type { ProductConfig } from "@creator-outdoor/config";
import type { Database } from "@creator-outdoor/db";
import { Elysia, t } from "elysia";
import type { PixPaymentProvider } from "../payments/provider";
import { WebhookValidationError } from "../payments/provider";
import { applyPaymentEvent } from "../services/payment-transitions";

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

      if (outcome.kind === "APPLIED" && outcome.refundRequired) {
        // The creator stopped being eligible while the payment was in flight.
        // The promotion was never delivered, so the money goes back.
        try {
          await provider.refundPayment(outcome.providerPaymentId);
        } catch (error) {
          // Reconciliation retries this; the boost is already VOID either way.
          console.error("refund_failed", {
            provider: provider.name,
            providerPaymentId: outcome.providerPaymentId,
            message: error instanceof Error ? error.message : "unknown",
          });
        }
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
