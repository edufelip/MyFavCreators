import type { ProductConfig } from "@creator-outdoor/config";
import { type Database, disableSubscriptionsByEmail } from "@creator-outdoor/db";
import { Elysia, t } from "elysia";
import type { EmailProvider } from "../email/provider";
import { log } from "../observability/logger";
import type { PixPaymentProvider } from "../payments/provider";
import { WebhookValidationError } from "../payments/provider";
import { runPaymentFollowUps } from "../services/payment-follow-ups";
import { applyPaymentEvent } from "../services/payment-transitions";

export type WebhookRouteDependencies = {
  readonly database: Database;
  readonly product: ProductConfig;
  readonly providers: ReadonlyMap<string, PixPaymentProvider>;
  readonly email?: EmailProvider;
  readonly webOrigin?: string;
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

  return new Elysia()
    .post(
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
            log.warn("webhook_rejected", { provider: params.provider, reason: error.message });
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
          await runPaymentFollowUps(dependencies, provider, outcome, now());
        } else if (outcome.kind !== "DUPLICATE") {
          /*
           * A payment the provider knows about and we do not, or a move the state
           * machine refuses. Both answer 200 — a provider that gets anything else
           * retries forever — so without this line they are acknowledged and
           * dropped in silence. If a provider id ever stops matching, because of
           * the wrong environment's credentials or a changed payload key, *every*
           * real payment takes this path and the only trace is a table nobody
           * queries. No payload content, just which kind and for which provider.
           */
          log.warn("webhook_no_effect", { provider: provider.name, outcome: outcome.kind });
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
    )
    .post(
      "/v1/webhooks/email/resend",
      async ({ body }) => {
        const payload = body as {
          type?: string;
          data?: { to?: string[] };
        };
        const eventType = payload.type;
        const recipients = payload.data?.to ?? [];

        if (eventType === "email.bounced" || eventType === "email.complained") {
          for (const recipient of recipients) {
            if (typeof recipient === "string") {
              const disabledCount = await disableSubscriptionsByEmail(
                dependencies.database,
                recipient.trim().toLowerCase(),
                now(),
              );
              if (disabledCount > 0) {
                log.info("email_subscription_disabled_on_bounce", {
                  reason: eventType,
                  count: disabledCount,
                });
              }
            }
          }
        }

        return { received: true };
      },
      {
        body: t.Object({
          type: t.Optional(t.String()),
          data: t.Optional(t.Object({ to: t.Optional(t.Array(t.String())) })),
        }),
        response: {
          200: t.Object({ received: t.Literal(true) }),
        },
      },
    );
}
