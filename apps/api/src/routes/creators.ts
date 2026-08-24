import type { ProductConfig } from "@creator-outdoor/config";
import {
  AcknowledgementDto,
  ApiErrorDto,
  CreatorDetailDto,
  CreatorReportRequestDto,
  CreatorSubmissionRequestDto,
  CreatorSubmissionResponseDto,
  OptOutChallengeDto,
  OptOutRequestDto,
  OptOutVerificationRequestDto,
  OptOutVerificationResponseDto,
  SitemapDto,
  Slug,
  TorcidaDto,
} from "@creator-outdoor/contracts";
import {
  type Database,
  findCreatorBySlug,
  insertReport,
  listPublicCreatorRefs,
} from "@creator-outdoor/db";
import { isPubliclyEligible } from "@creator-outdoor/domain";
import { Elysia, t } from "elysia";
import {
  clientKey,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimitScope,
  rateLimitRules,
} from "../security/rate-limit";
import { getPublicCreatorDetail } from "../services/creator-detail";
import { submitCreator } from "../services/creator-submission";
import { CreatorNotPubliclyVisibleError, requestOptOut, verifyOptOut } from "../services/opt-out";
import { getTorcida } from "../services/torcida";

export type CreatorRouteDependencies = {
  readonly database: Database;
  readonly product: ProductConfig;
  readonly rateLimiter: RateLimiter;
  readonly now?: () => Date;
};

const slugParams = t.Object({ slug: Slug });

/**
 * Validated at the boundary with Elysia's schema, which also coerces the
 * numbers a query string can only carry as text. Frontend types are never
 * treated as runtime validation.
 */
const torcidaQuery = t.Object({
  window: t.Optional(t.Union([t.Literal("weekly"), t.Literal("all-time")])),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 20 })),
  offset: t.Optional(t.Integer({ minimum: 0, maximum: 10_000, default: 0 })),
});

const TOO_MANY_REQUESTS = {
  error: { code: "RATE_LIMITED" as const, message: "Muitas tentativas. Tente novamente em breve." },
};
const NOT_FOUND = {
  error: { code: "NOT_FOUND" as const, message: "Perfil não encontrado." },
};

export function creatorRoutes(dependencies: CreatorRouteDependencies) {
  const now = dependencies.now ?? (() => new Date());

  const rules = rateLimitRules(dependencies.product);
  const limit = (request: Request, scope: RateLimitScope): RateLimitDecision =>
    dependencies.rateLimiter.check(`${scope}:${clientKey(request)}`, rules[scope]);

  return (
    new Elysia({ prefix: "/v1/creators" })
      /*
       * Declared before "/:slug" so the literal wins: a path parameter that also
       * matches a fixed route is a bug waiting for a creator called "sitemap".
       */
      .get(
        "/sitemap",
        async ({ query }) => {
          const entries = await listPublicCreatorRefs(dependencies.database, query.limit ?? 5_000);
          return {
            entries: entries.map((entry) => ({
              slug: entry.slug,
              updatedAt: entry.updatedAt.toISOString(),
            })),
          };
        },
        {
          query: t.Object({
            limit: t.Optional(t.Integer({ minimum: 1, maximum: 50_000, default: 5_000 })),
          }),
          response: SitemapDto,
        },
      )
      .get(
        "/:slug",
        async ({ params, status }) => {
          const detail = await getPublicCreatorDetail(
            dependencies.database,
            dependencies.product,
            params.slug,
            now(),
          );
          // A creator who is not APPROVED is indistinguishable from one that never
          // existed, so this endpoint cannot be used to enumerate moderation.
          return detail === null ? status(404, NOT_FOUND) : detail;
        },
        { params: slugParams, response: { 200: CreatorDetailDto, 404: ApiErrorDto } },
      )
      .get(
        "/:slug/torcida",
        async ({ params, query, status }) => {
          const torcida = await getTorcida(dependencies.database, dependencies.product, {
            slug: params.slug,
            window: query.window ?? "weekly",
            limit: query.limit ?? 20,
            offset: query.offset ?? 0,
            now: now(),
          });
          return torcida === null ? status(404, NOT_FOUND) : torcida;
        },
        {
          params: slugParams,
          query: torcidaQuery,
          response: { 200: TorcidaDto, 404: ApiErrorDto },
        },
      )
      .post(
        "/submissions",
        async ({ body, request, set, status }) => {
          const decision = limit(request, "creatorSubmission");
          if (!decision.allowed) {
            set.headers["retry-after"] = String(decision.retryAfterSeconds);
            return status(429, TOO_MANY_REQUESTS);
          }
          return submitCreator(dependencies.database, dependencies.product, {
            url: body.url,
            categorySlug: body.categorySlug,
          });
        },
        {
          body: CreatorSubmissionRequestDto,
          response: { 200: CreatorSubmissionResponseDto, 429: ApiErrorDto },
        },
      )
      .post(
        "/:slug/reports",
        async ({ params, body, request, set, status }) => {
          const decision = limit(request, "report");
          if (!decision.allowed) {
            set.headers["retry-after"] = String(decision.retryAfterSeconds);
            return status(429, TOO_MANY_REQUESTS);
          }
          const creator = await findCreatorBySlug(dependencies.database, params.slug);
          // Acknowledge either way: a report about a profile nobody can see must
          // not confirm that the profile exists.
          if (creator !== null && isPubliclyEligible(creator.moderationStatus)) {
            await insertReport(dependencies.database, {
              creatorId: creator.id,
              reason: body.reason,
              details: body.details ?? null,
            });
          }
          return { ok: true, message: "Denúncia registrada. Obrigado." };
        },
        {
          params: slugParams,
          body: CreatorReportRequestDto,
          response: { 200: AcknowledgementDto, 429: ApiErrorDto },
        },
      )
      .post(
        "/:slug/opt-out",
        async ({ params, body, request, set, status }) => {
          const decision = limit(request, "optOutRequest");
          if (!decision.allowed) {
            set.headers["retry-after"] = String(decision.retryAfterSeconds);
            return status(429, TOO_MANY_REQUESTS);
          }
          try {
            return await requestOptOut(dependencies.database, {
              slug: params.slug,
              contactEmail: body.contactEmail,
              now: now(),
            });
          } catch (error) {
            if (error instanceof CreatorNotPubliclyVisibleError) {
              return status(404, NOT_FOUND);
            }
            throw error;
          }
        },
        {
          params: slugParams,
          body: OptOutRequestDto,
          response: { 200: OptOutChallengeDto, 404: ApiErrorDto, 429: ApiErrorDto },
        },
      )
      .post(
        "/:slug/opt-out/verify",
        async ({ params, body, request, set, status }) => {
          const decision = limit(request, "optOutVerify");
          if (!decision.allowed) {
            set.headers["retry-after"] = String(decision.retryAfterSeconds);
            return status(429, TOO_MANY_REQUESTS);
          }
          try {
            return await verifyOptOut(dependencies.database, {
              slug: params.slug,
              profileText: body.profileText,
              now: now(),
            });
          } catch (error) {
            if (error instanceof CreatorNotPubliclyVisibleError) {
              return status(404, NOT_FOUND);
            }
            throw error;
          }
        },
        {
          params: slugParams,
          body: OptOutVerificationRequestDto,
          response: {
            200: OptOutVerificationResponseDto,
            404: ApiErrorDto,
            429: ApiErrorDto,
          },
        },
      )
  );
}
