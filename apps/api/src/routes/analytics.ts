import type { ProductConfig } from "@creator-outdoor/config";
import {
  ApiErrorDto,
  DeliveryReportDto,
  ImpressionBatchRequestDto,
  ImpressionBatchResponseDto,
  OutboundClickRequestDto,
  OutboundClickResponseDto,
  Slug,
} from "@creator-outdoor/contracts";
import type { Database } from "@creator-outdoor/db";
import { InvalidImpressionBatchError } from "@creator-outdoor/domain";
import { Elysia, t } from "elysia";
import {
  clientKey,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimitScope,
  rateLimitRules,
} from "../security/rate-limit";
import {
  getDeliveryReport,
  recordImpressionBatch,
  resolveOutboundClick,
} from "../services/analytics";

export type AnalyticsRouteDependencies = {
  readonly database: Database;
  readonly product: ProductConfig;
  readonly rateLimiter: RateLimiter;
  readonly now?: () => Date;
};

const TOO_MANY_REQUESTS = {
  error: { code: "RATE_LIMITED" as const, message: "Muitas tentativas. Tente novamente em breve." },
};
const NOT_FOUND = { error: { code: "NOT_FOUND" as const, message: "Link nao encontrado." } };
const BAD_REQUEST = { error: { code: "BAD_REQUEST" as const, message: "Requisicao invalida." } };

/**
 * The analytics session identifier.
 *
 * Supplied by the web server from an httpOnly cookie, never by a browser
 * script and never by the caller's body: a client that could name its own
 * session could mint unlimited impressions by inventing new ones. A request
 * without it is refused rather than counted under a shared bucket.
 */
const SESSION_HEADER = "x-analytics-session";
const MIN_SESSION_LENGTH = 8;

/**
 * Delivery measurement endpoints.
 *
 * Nothing here touches a ranking. These routes exist so the platform can say
 * what it actually delivered, which is the thing a boost buys; they never make
 * a creator rank higher, and no ranking query reads what they write.
 */
export function analyticsRoutes(dependencies: AnalyticsRouteDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const rules = rateLimitRules(dependencies.product);
  const limit = (request: Request, scope: RateLimitScope): RateLimitDecision =>
    dependencies.rateLimiter.check(`${scope}:${clientKey(request)}`, rules[scope]);

  return new Elysia({ prefix: "/v1" })
    .post(
      "/impressions",
      async ({ body, request, set, status }) => {
        const sessionId = request.headers.get(SESSION_HEADER);
        if (sessionId === null || sessionId.length < MIN_SESSION_LENGTH) {
          return status(400, BAD_REQUEST);
        }

        const decision = limit(request, "analyticsIngest");
        if (!decision.allowed) {
          set.headers["retry-after"] = String(decision.retryAfterSeconds);
          return status(429, TOO_MANY_REQUESTS);
        }

        try {
          return await recordImpressionBatch(dependencies.database, {
            sessionId,
            entries: body.entries,
            now: now(),
          });
        } catch (error) {
          if (error instanceof InvalidImpressionBatchError) {
            return status(400, BAD_REQUEST);
          }
          throw error;
        }
      },
      {
        body: ImpressionBatchRequestDto,
        response: {
          200: ImpressionBatchResponseDto,
          400: ApiErrorDto,
          429: ApiErrorDto,
        },
      },
    )
    .post(
      "/outbound-clicks",
      async ({ body, request, set, status }) => {
        /**
         * A click is measured when it can be, and always redirects.
         *
         * Unlike an impression, a missing session is not a reason to refuse:
         * somebody following a link from outside the site has no session yet,
         * and creating one to count them would mean starting to track a visitor
         * who only clicked a link. Their click goes uncounted instead.
         */
        const header = request.headers.get(SESSION_HEADER);
        const sessionId = header !== null && header.length >= MIN_SESSION_LENGTH ? header : null;

        const decision = limit(request, "analyticsIngest");
        if (!decision.allowed) {
          set.headers["retry-after"] = String(decision.retryAfterSeconds);
          return status(429, TOO_MANY_REQUESTS);
        }

        const resolved = await resolveOutboundClick(dependencies.database, {
          creatorLinkId: body.creatorLinkId,
          sessionId,
          referrer: body.referrer ?? null,
          now: now(),
        });
        // An unknown link and a link belonging to a creator who is no longer
        // public answer the same way, so this cannot enumerate moderation.
        return resolved === null ? status(404, NOT_FOUND) : resolved;
      },
      {
        body: OutboundClickRequestDto,
        response: {
          200: OutboundClickResponseDto,
          400: ApiErrorDto,
          404: ApiErrorDto,
          429: ApiErrorDto,
        },
      },
    )
    .get(
      "/creators/:slug/delivery",
      async ({ params, query, status }) => {
        const report = await getDeliveryReport(dependencies.database, dependencies.product, {
          slug: params.slug,
          window: query.window ?? "weekly",
          now: now(),
        });
        return report === null ? status(404, NOT_FOUND) : report;
      },
      {
        params: t.Object({ slug: Slug }),
        query: t.Object({
          window: t.Optional(t.Union([t.Literal("weekly"), t.Literal("all-time")])),
        }),
        response: { 200: DeliveryReportDto, 404: ApiErrorDto },
      },
    );
}
