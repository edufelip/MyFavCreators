import type { ProductConfig } from "@creator-outdoor/config";
import {
  ApiErrorDto,
  ClaimChallengeDto,
  ClaimVerificationRequestDto,
  ClaimVerificationResponseDto,
  CreatorDashboardDto,
  CreatorProfileUpdateDto,
  NotificationPreferenceDto,
  Slug,
} from "@creator-outdoor/contracts";
import {
  type ClaimedCreator,
  type Database,
  disableSubscription,
  setClaimEmail,
} from "@creator-outdoor/db";
import { type NotificationType, normalizeEmail } from "@creator-outdoor/domain";
import { Elysia, t } from "elysia";
import {
  clientKey,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimitScope,
  rateLimitRules,
} from "../security/rate-limit";
import {
  authenticateClaim,
  CreatorNotClaimableError,
  requestClaim,
  updateClaimedProfile,
  verifyClaim,
} from "../services/claims";
import { getCreatorDashboard } from "../services/creator-dashboard";
import { subscribeToNotifications } from "../services/notifications";

export type ClaimRouteDependencies = {
  readonly database: Database;
  readonly product: ProductConfig;
  readonly rateLimiter: RateLimiter;
  readonly now?: () => Date;
};

const TOO_MANY_REQUESTS = {
  error: { code: "RATE_LIMITED" as const, message: "Muitas tentativas. Tente novamente em breve." },
};
const NOT_FOUND = { error: { code: "NOT_FOUND" as const, message: "Perfil nao encontrado." } };
const UNAUTHORIZED = {
  error: { code: "UNAUTHORIZED" as const, message: "Link de gerenciamento invalido." },
};

/**
 * The management token, carried as a bearer credential.
 *
 * It never travels in a URL: a management link in browser history, a referrer
 * header or an access log would hand somebody else the profile. The web app
 * keeps it in an httpOnly cookie and sends it from its server.
 */
function readToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header === null || !header.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = header.slice("bearer ".length).trim();
  return token.length === 0 ? null : token;
}

/**
 * Claiming a profile, and what a claimed profile may do.
 *
 * The claim itself is the same proof of control the removal flow uses: a code
 * that has to appear on the profile. Requesting one changes nothing public.
 */
export function claimRoutes(dependencies: ClaimRouteDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const rules = rateLimitRules(dependencies.product);
  const limit = (request: Request, scope: RateLimitScope): RateLimitDecision =>
    dependencies.rateLimiter.check(`${scope}:${clientKey(request)}`, rules[scope]);

  const authenticate = async (request: Request): Promise<ClaimedCreator | null> =>
    authenticateClaim(dependencies.database, readToken(request));

  return new Elysia({ prefix: "/v1" })
    .post(
      "/creators/:slug/claims",
      async ({ params, request, set, status }) => {
        const decision = limit(request, "optOutRequest");
        if (!decision.allowed) {
          set.headers["retry-after"] = String(decision.retryAfterSeconds);
          return status(429, TOO_MANY_REQUESTS);
        }

        try {
          return await requestClaim(dependencies.database, { slug: params.slug, now: now() });
        } catch (error) {
          if (error instanceof CreatorNotClaimableError) {
            return status(404, NOT_FOUND);
          }
          throw error;
        }
      },
      {
        params: t.Object({ slug: Slug }),
        response: { 200: ClaimChallengeDto, 404: ApiErrorDto, 429: ApiErrorDto },
      },
    )
    .post(
      "/creators/:slug/claims/verify",
      async ({ body, params, request, set, status }) => {
        const decision = limit(request, "optOutVerify");
        if (!decision.allowed) {
          set.headers["retry-after"] = String(decision.retryAfterSeconds);
          return status(429, TOO_MANY_REQUESTS);
        }

        try {
          return await verifyClaim(dependencies.database, {
            slug: params.slug,
            profileText: body.profileText,
            email: body.email,
            now: now(),
          });
        } catch (error) {
          if (error instanceof CreatorNotClaimableError) {
            return status(404, NOT_FOUND);
          }
          throw error;
        }
      },
      {
        params: t.Object({ slug: Slug }),
        body: ClaimVerificationRequestDto,
        response: { 200: ClaimVerificationResponseDto, 404: ApiErrorDto, 429: ApiErrorDto },
      },
    )
    .get(
      "/creators/me",
      async ({ request, status }) => {
        const claimed = await authenticate(request);
        if (claimed === null) {
          return status(401, UNAUTHORIZED);
        }
        const dashboard = await getCreatorDashboard(
          dependencies.database,
          dependencies.product,
          claimed,
          now(),
        );
        return dashboard === null ? status(401, UNAUTHORIZED) : dashboard;
      },
      { response: { 200: CreatorDashboardDto, 401: ApiErrorDto } },
    )
    .patch(
      "/creators/me",
      async ({ body, request, status }) => {
        const claimed = await authenticate(request);
        if (claimed === null) {
          return status(401, UNAUTHORIZED);
        }

        try {
          await updateClaimedProfile(dependencies.database, claimed, {
            bio: body.bio,
            categorySlug: body.categorySlug,
            now: now(),
          });
        } catch (error) {
          if (error instanceof CreatorNotClaimableError) {
            return status(404, NOT_FOUND);
          }
          throw error;
        }

        const dashboard = await getCreatorDashboard(
          dependencies.database,
          dependencies.product,
          claimed,
          now(),
        );
        return dashboard === null ? status(401, UNAUTHORIZED) : dashboard;
      },
      {
        body: CreatorProfileUpdateDto,
        response: { 200: CreatorDashboardDto, 401: ApiErrorDto, 404: ApiErrorDto },
      },
    )
    .put(
      "/creators/me/notifications",
      async ({ body, request, status }) => {
        const claimed = await authenticate(request);
        if (claimed === null) {
          return status(401, UNAUTHORIZED);
        }

        const email = readEmail(body.email) ?? claimed.email;
        if (email === null) {
          // Nothing to turn on without somewhere to send it.
          return { notifyDethrone: false, notifyWeeklyRecap: false };
        }
        if (email !== claimed.email) {
          await setClaimEmail(dependencies.database, claimed.creatorId, email);
        }

        // Each notification is its own switch, so turning one off leaves the
        // other running.
        const wanted: ReadonlyArray<readonly [NotificationType, boolean]> = [
          ["DETHRONE", body.notifyDethrone],
          ["WEEKLY_RECAP", body.notifyWeeklyRecap],
        ];
        for (const [type, on] of wanted) {
          if (on) {
            await subscribeToNotifications(dependencies.database, {
              email,
              creatorId: claimed.creatorId,
              types: [type],
            });
          } else {
            await disableSubscription(dependencies.database, {
              email,
              creatorId: claimed.creatorId,
              type,
              at: now(),
            });
          }
        }
        return {
          notifyDethrone: body.notifyDethrone,
          notifyWeeklyRecap: body.notifyWeeklyRecap,
        };
      },
      {
        body: t.Object({
          notifyDethrone: t.Boolean(),
          notifyWeeklyRecap: t.Boolean(),
          email: t.Optional(t.String({ maxLength: 254 })),
        }),
        response: { 200: NotificationPreferenceDto, 401: ApiErrorDto },
      },
    );
}

function readEmail(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  try {
    return normalizeEmail(value);
  } catch {
    return null;
  }
}
