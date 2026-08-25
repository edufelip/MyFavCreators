import type { ProductConfig } from "@creator-outdoor/config";
import {
  ApiErrorDto,
  UnsubscribeRequestDto,
  UnsubscribeResponseDto,
} from "@creator-outdoor/contracts";
import { type Database, disableSubscriptionByToken } from "@creator-outdoor/db";
import { Elysia } from "elysia";
import { log } from "../observability/logger";
import {
  clientKey,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimitScope,
  rateLimitRules,
} from "../security/rate-limit";

export type NotificationRouteDependencies = {
  readonly database: Database;
  readonly product: ProductConfig;
  readonly rateLimiter: RateLimiter;
  readonly now?: () => Date;
};

const TOO_MANY_REQUESTS = {
  error: { code: "RATE_LIMITED" as const, message: "Muitas tentativas. Tente novamente em breve." },
};

/**
 * One-click unsubscribe.
 *
 * A POST, because RFC 8058 one-click uses one and because a link that
 * unsubscribes on GET is unsubscribed by the first mail client that prefetches
 * it. The web app turns the emailed link into this call.
 *
 * The answer never depends on whether the token existed: a link that said
 * "unknown" for a wrong token and "done" for a right one would let anybody
 * holding a forwarded email test addresses. Rate limited for the same reason.
 */
export function notificationRoutes(dependencies: NotificationRouteDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const rules = rateLimitRules(dependencies.product);
  const limit = (request: Request, scope: RateLimitScope): RateLimitDecision =>
    dependencies.rateLimiter.check(`${scope}:${clientKey(request)}`, rules[scope]);

  return new Elysia({ prefix: "/v1/notifications" }).post(
    "/unsubscribe",
    async ({ body, request, set, status }) => {
      const decision = limit(request, "optOutVerify");
      if (!decision.allowed) {
        set.headers["retry-after"] = String(decision.retryAfterSeconds);
        return status(429, TOO_MANY_REQUESTS);
      }

      const disabled = await disableSubscriptionByToken(dependencies.database, body.token, now());
      if (disabled !== null) {
        log.info("notification_unsubscribed", { type: disabled });
      }
      return { acknowledged: true as const };
    },
    {
      body: UnsubscribeRequestDto,
      response: { 200: UnsubscribeResponseDto, 429: ApiErrorDto },
    },
  );
}
