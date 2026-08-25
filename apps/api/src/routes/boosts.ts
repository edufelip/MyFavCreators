import type { ProductConfig } from "@creator-outdoor/config";
import {
  ApiErrorDto,
  CheckoutDto,
  CreateBoostRequestDto,
  PaymentStatusResponseDto,
  Uuid,
} from "@creator-outdoor/contracts";
import type { Database } from "@creator-outdoor/db";
import { Elysia, t } from "elysia";
import type { PixPaymentProvider } from "../payments/provider";
import {
  clientKey,
  type RateLimitDecision,
  type RateLimiter,
  rateLimitRules,
} from "../security/rate-limit";
import {
  BoostAmountError,
  CreatorNotBoostableError,
  createBoost,
  getCheckout,
  getPaymentStatusResponse,
} from "../services/boosts";

export type BoostRouteDependencies = {
  readonly database: Database;
  readonly product: ProductConfig;
  readonly provider: PixPaymentProvider;
  readonly fanIdentitySecret: string;
  readonly rateLimiter: RateLimiter;
  readonly now?: () => Date;
};

const TOO_MANY_REQUESTS = {
  error: { code: "RATE_LIMITED" as const, message: "Muitas tentativas. Tente novamente em breve." },
};
const NOT_FOUND = { error: { code: "NOT_FOUND" as const, message: "Não encontrado." } };

export function boostRoutes(dependencies: BoostRouteDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const rules = rateLimitRules(dependencies.product);
  const limit = (request: Request): RateLimitDecision =>
    dependencies.rateLimiter.check(`boost:${clientKey(request)}`, rules.boostCreation);

  return new Elysia()
    .post(
      "/v1/boosts",
      async ({ body, request, set, status }) => {
        const decision = limit(request);
        if (!decision.allowed) {
          set.headers["retry-after"] = String(decision.retryAfterSeconds);
          return status(429, TOO_MANY_REQUESTS);
        }

        try {
          return await createBoost(
            dependencies.database,
            dependencies.product,
            dependencies.provider,
            dependencies.fanIdentitySecret,
            {
              creatorSlug: body.creatorSlug,
              amountCents: body.amountCents,
              origin: body.origin ?? "DIRECT",
              supporterName: body.supporterName,
              supporterMessage: body.supporterMessage,
              anonymous: body.anonymous,
              supporterEmail: body.supporterEmail,
              notifyOnDethrone: body.notifyOnDethrone,
              notifyWeeklyRecap: body.notifyWeeklyRecap,
              // A caller that sends no supporter key still gets a stable
              // identity for this boost alone, rather than being merged with
              // every other anonymous supporter.
              supporterKey: body.supporterKey ?? `anon:${crypto.randomUUID()}`,
              now: now(),
            },
          );
        } catch (error) {
          if (error instanceof CreatorNotBoostableError) {
            return status(404, NOT_FOUND);
          }
          if (error instanceof BoostAmountError) {
            return status(422, {
              error: { code: "UNPROCESSABLE" as const, message: error.message },
            });
          }
          throw error;
        }
      },
      {
        body: CreateBoostRequestDto,
        response: {
          200: CheckoutDto,
          404: ApiErrorDto,
          422: ApiErrorDto,
          429: ApiErrorDto,
        },
      },
    )
    .get(
      "/v1/payments/:id/checkout",
      async ({ params, status }) => {
        const checkout = await getCheckout(dependencies.database, params.id);
        return checkout === null ? status(404, NOT_FOUND) : checkout;
      },
      {
        params: t.Object({ id: Uuid }),
        response: { 200: CheckoutDto, 404: ApiErrorDto },
      },
    )
    .get(
      "/v1/payments/:id/status",
      async ({ params, status }) => {
        const response = await getPaymentStatusResponse(
          dependencies.database,
          dependencies.product,
          params.id,
          now(),
        );
        return response === null ? status(404, NOT_FOUND) : response;
      },
      {
        params: t.Object({ id: Uuid }),
        response: { 200: PaymentStatusResponseDto, 404: ApiErrorDto },
      },
    );
}
