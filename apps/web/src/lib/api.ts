import "server-only";

import { webConfig } from "@creator-outdoor/config/web";
import {
  AcknowledgementDto,
  type CheckoutDto,
  CheckoutDto as CheckoutSchema,
  type ClaimChallengeDto,
  ClaimChallengeDto as ClaimChallengeSchema,
  type ClaimVerificationResponseDto,
  ClaimVerificationResponseDto as ClaimVerificationSchema,
  type CreateBoostRequestDto,
  type CreatorDashboardDto,
  CreatorDashboardDto as CreatorDashboardSchema,
  type CreatorDetailDto,
  CreatorDetailDto as CreatorDetailSchema,
  type CreatorReportRequestDto,
  type CreatorSubmissionResponseDto,
  CreatorSubmissionResponseDto as CreatorSubmissionSchema,
  type HallOfFameDto,
  HallOfFameDto as HallOfFameSchema,
  type ImpressionBatchResponseDto,
  ImpressionBatchResponseDto as ImpressionBatchSchema,
  type LeaderboardResponseDto,
  LeaderboardResponseDto as LeaderboardSchema,
  type OptOutChallengeDto,
  OptOutChallengeDto as OptOutChallengeSchema,
  type OptOutVerificationResponseDto,
  OptOutVerificationResponseDto as OptOutVerificationSchema,
  type OutboundClickResponseDto,
  OutboundClickResponseDto as OutboundClickSchema,
  type PaymentStatusResponseDto,
  PaymentStatusResponseDto as PaymentStatusSchema,
  parseContract,
  type RankEventListDto,
  RankEventListDto as RankEventListSchema,
  type RotationResponseDto,
  RotationResponseDto as RotationSchema,
  type SitemapDto,
  SitemapDto as SitemapSchema,
  type TorcidaDto,
  TorcidaDto as TorcidaSchema,
  type UnsubscribeResponseDto,
  UnsubscribeResponseDto as UnsubscribeSchema,
} from "@creator-outdoor/contracts";
import { headers } from "next/headers";

export const RANKING_TABS = ["weekly", "all-time"] as const;
export type RankingTab = (typeof RANKING_TABS)[number];

export type LeaderboardRequest = {
  readonly tab: RankingTab;
  readonly limit?: number;
  readonly category?: string;
};

/**
 * Reads a ranking from the API.
 *
 * apps/web never touches PostgreSQL. It also never trusts the shape of what
 * comes back: the response is validated against the published contract before
 * a single field reaches a component.
 */
export async function fetchLeaderboard(
  request: LeaderboardRequest,
): Promise<LeaderboardResponseDto> {
  const url = new URL(`/v1/rankings/${request.tab}`, webConfig.apiOrigin);
  if (request.limit !== undefined) {
    url.searchParams.set("limit", String(request.limit));
  }
  if (request.category !== undefined) {
    url.searchParams.set("category", request.category);
  }

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    // The leaderboard is live; every request renders the current ranking.
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Ranking request failed with status ${response.status}`);
  }
  return parseContract(LeaderboardSchema, await response.json(), "LeaderboardResponse");
}

export type LeaderboardResult =
  | { readonly ok: true; readonly data: LeaderboardResponseDto }
  | { readonly ok: false };

/** Never lets an unreachable API turn the public billboard into an error page. */
export async function loadLeaderboard(request: LeaderboardRequest): Promise<LeaderboardResult> {
  try {
    return { ok: true, data: await fetchLeaderboard(request) };
  } catch (error) {
    console.error("leaderboard_fetch_failed", error instanceof Error ? error.message : "unknown");
    return { ok: false };
  }
}

/**
 * Raised when the API refuses a write because the caller is over its limit.
 * Distinct from a fault so the UI can say what actually happened.
 */
export class RateLimitedError extends Error {
  override readonly name = "RateLimitedError";
}

/**
 * Forwards the visitor's address to the API.
 *
 * Every public write goes browser -> apps/web -> apps/api, so without this the
 * API would see one address for the entire internet and a single enthusiastic
 * visitor could throttle everybody else. This value is a throttling key only and
 * is never treated as an authentication claim.
 */
async function forwardedClientHeaders(): Promise<Record<string, string>> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for") ?? headerList.get("x-real-ip");
  return forwarded === null ? {} : { "x-forwarded-for": forwarded };
}

async function postJson<TResult>(
  path: string,
  body: unknown,
  schema: Parameters<typeof parseContract>[0],
  label: string,
): Promise<TResult> {
  const response = await fetch(new URL(path, webConfig.apiOrigin), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(await forwardedClientHeaders()),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (response.status === 429) {
    throw new RateLimitedError(`${path} is rate limited`);
  }
  if (!response.ok && response.status !== 404) {
    throw new Error(`${path} responded ${response.status}`);
  }
  return parseContract(schema, await response.json(), label) as TResult;
}

/** The public creator page. Returns null for anything that is not APPROVED. */
export async function fetchCreatorDetail(slug: string): Promise<CreatorDetailDto | null> {
  const response = await fetch(
    new URL(`/v1/creators/${encodeURIComponent(slug)}`, webConfig.apiOrigin),
    {
      headers: { accept: "application/json" },
      cache: "no-store",
    },
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Creator request failed with status ${response.status}`);
  }
  return parseContract(CreatorDetailSchema, await response.json(), "CreatorDetail");
}

export type ImpressionEntry = {
  readonly creatorId: string;
  readonly surface: "MARQUEE" | "LEADERBOARD" | "ROTATION" | "CREATOR_PAGE" | "EMBED";
};

/**
 * Reports what a page displayed.
 *
 * The session identifier is added here, server-side, from an httpOnly cookie.
 * It is never part of the browser's request: a client able to name its own
 * session could mint impressions for any creator by inventing new ones.
 */
export async function reportImpressions(
  sessionId: string,
  entries: readonly ImpressionEntry[],
): Promise<ImpressionBatchResponseDto> {
  const response = await fetch(new URL("/v1/impressions", webConfig.apiOrigin), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-analytics-session": sessionId,
      ...(await forwardedClientHeaders()),
    },
    body: JSON.stringify({ entries }),
    cache: "no-store",
  });
  if (response.status === 429) {
    throw new RateLimitedError("/v1/impressions is rate limited");
  }
  if (!response.ok) {
    throw new Error(`/v1/impressions responded ${response.status}`);
  }
  return parseContract(ImpressionBatchSchema, await response.json(), "ImpressionBatchResponse");
}

/**
 * Resolves a tracked outbound link and counts the click.
 *
 * The destination comes back from the API, derived from the stored link, so no
 * caller-supplied URL can ever become a redirect target.
 */
export async function resolveOutboundLink(
  creatorLinkId: string,
  sessionId: string | null,
  referrer: string | null,
): Promise<OutboundClickResponseDto | null> {
  const response = await fetch(new URL("/v1/outbound-clicks", webConfig.apiOrigin), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(sessionId === null ? {} : { "x-analytics-session": sessionId }),
      ...(await forwardedClientHeaders()),
    },
    body: JSON.stringify({ creatorLinkId, referrer }),
    cache: "no-store",
  });
  if (response.status === 404 || response.status === 400) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`/v1/outbound-clicks responded ${response.status}`);
  }
  return parseContract(OutboundClickSchema, await response.json(), "OutboundClickResponse");
}

/**
 * Switches off the notifications an emailed link points at.
 *
 * The API answers the same way for a live token, a used one and one that never
 * existed, so nothing here can report which it was.
 */
export function unsubscribeFromNotifications(token: string): Promise<UnsubscribeResponseDto> {
  return postJson(
    "/v1/notifications/unsubscribe",
    { token },
    UnsubscribeSchema,
    "UnsubscribeResponse",
  );
}

/** Opens a claim. Issues a code and changes nothing public. */
export function requestCreatorClaim(slug: string): Promise<ClaimChallengeDto> {
  return postJson(
    `/v1/creators/${encodeURIComponent(slug)}/claims`,
    {},
    ClaimChallengeSchema,
    "ClaimChallenge",
  );
}

export function verifyCreatorClaim(
  slug: string,
  profileText: string,
  email: string | null,
): Promise<ClaimVerificationResponseDto> {
  return postJson(
    `/v1/creators/${encodeURIComponent(slug)}/claims/verify`,
    { profileText, ...(email === null ? {} : { email }) },
    ClaimVerificationSchema,
    "ClaimVerificationResponse",
  );
}

/**
 * Reads a claimed creator's own view.
 *
 * The management token travels in an Authorization header from this server,
 * never in a URL: a token in browser history, a referrer or an access log would
 * hand somebody else the profile.
 */
export async function fetchCreatorDashboard(token: string): Promise<CreatorDashboardDto | null> {
  const response = await fetch(new URL("/v1/creators/me", webConfig.apiOrigin), {
    headers: { accept: "application/json", authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Creator dashboard request failed with status ${response.status}`);
  }
  return parseContract(CreatorDashboardSchema, await response.json(), "CreatorDashboard");
}

export type ProfileUpdate = {
  readonly bio?: string | null;
  readonly categorySlug?: string;
};

export async function updateCreatorProfile(
  token: string,
  update: ProfileUpdate,
): Promise<CreatorDashboardDto | null> {
  const response = await fetch(new URL("/v1/creators/me", webConfig.apiOrigin), {
    method: "PATCH",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(await forwardedClientHeaders()),
    },
    body: JSON.stringify(update),
    cache: "no-store",
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Profile update failed with status ${response.status}`);
  }
  return parseContract(CreatorDashboardSchema, await response.json(), "CreatorDashboard");
}

export async function setCreatorNotifications(
  token: string,
  notifyDethrone: boolean,
  email: string | null,
): Promise<void> {
  const response = await fetch(new URL("/v1/creators/me/notifications", webConfig.apiOrigin), {
    method: "PUT",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(await forwardedClientHeaders()),
    },
    body: JSON.stringify({ notifyDethrone, ...(email === null ? {} : { email }) }),
    cache: "no-store",
  });
  if (!response.ok && response.status !== 401) {
    throw new Error(`Notification preference failed with status ${response.status}`);
  }
}

/** Every profile a sitemap may list. Only APPROVED creators come back. */
export async function fetchSitemapEntries(limit = 5_000): Promise<SitemapDto> {
  const url = new URL("/v1/creators/sitemap", webConfig.apiOrigin);
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    // A sitemap is read by crawlers, not by people; an hour stale is fine and
    // keeps a crawl from becoming a load test.
    next: { revalidate: 3_600 },
  });
  if (!response.ok) {
    throw new Error(`Sitemap request failed with status ${response.status}`);
  }
  return parseContract(SitemapSchema, await response.json(), "Sitemap");
}

/** Past weekly champions, most recent first. */
export async function fetchHallOfFame(limit = 20): Promise<HallOfFameDto> {
  const url = new URL("/v1/hall-da-fama", webConfig.apiOrigin);
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Hall da Fama request failed with status ${response.status}`);
  }
  return parseContract(HallOfFameSchema, await response.json(), "HallOfFame");
}

export type TorcidaRequest = {
  readonly slug: string;
  readonly window?: "weekly" | "all-time";
  readonly limit?: number;
};

/** A creator's supporter wall. `null` when the creator is not public. */
export async function fetchTorcida(request: TorcidaRequest): Promise<TorcidaDto | null> {
  const url = new URL(
    `/v1/creators/${encodeURIComponent(request.slug)}/torcida`,
    webConfig.apiOrigin,
  );
  if (request.window !== undefined) {
    url.searchParams.set("window", request.window);
  }
  if (request.limit !== undefined) {
    url.searchParams.set("limit", String(request.limit));
  }

  const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Torcida request failed with status ${response.status}`);
  }
  return parseContract(TorcidaSchema, await response.json(), "Torcida");
}

export function submitCreatorUrl(url: string): Promise<CreatorSubmissionResponseDto> {
  return postJson(
    "/v1/creators/submissions",
    { url },
    CreatorSubmissionSchema,
    "CreatorSubmissionResponse",
  );
}

export function reportCreator(
  slug: string,
  body: CreatorReportRequestDto,
): Promise<{ ok: boolean; message: string }> {
  return postJson(
    `/v1/creators/${encodeURIComponent(slug)}/reports`,
    body,
    AcknowledgementDto,
    "Acknowledgement",
  );
}

export function requestCreatorOptOut(slug: string): Promise<OptOutChallengeDto> {
  return postJson(
    `/v1/creators/${encodeURIComponent(slug)}/opt-out`,
    {},
    OptOutChallengeSchema,
    "OptOutChallenge",
  );
}

export function verifyCreatorOptOut(
  slug: string,
  profileText: string,
): Promise<OptOutVerificationResponseDto> {
  return postJson(
    `/v1/creators/${encodeURIComponent(slug)}/opt-out/verify`,
    { profileText },
    OptOutVerificationSchema,
    "OptOutVerificationResponse",
  );
}

/** Creates a boost and its PIX payment. Never called from a client component. */
export function createBoost(body: CreateBoostRequestDto): Promise<CheckoutDto> {
  return postJson("/v1/boosts", body, CheckoutSchema, "Checkout");
}

/**
 * Reads the authoritative payment state.
 *
 * The checkout screen polls this; what the browser believes about a payment is
 * never authoritative, and only the API and the provider decide the truth.
 */
export async function fetchPaymentStatus(
  paymentId: string,
): Promise<PaymentStatusResponseDto | null> {
  const response = await fetch(
    new URL(`/v1/payments/${encodeURIComponent(paymentId)}/status`, webConfig.apiOrigin),
    { headers: { accept: "application/json" }, cache: "no-store" },
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Payment status request failed with status ${response.status}`);
  }
  return parseContract(PaymentStatusSchema, await response.json(), "PaymentStatusResponse");
}

/** The stored checkout payload for a payment. */
export async function fetchCheckout(paymentId: string): Promise<CheckoutDto | null> {
  const response = await fetch(
    new URL(`/v1/payments/${encodeURIComponent(paymentId)}/checkout`, webConfig.apiOrigin),
    { headers: { accept: "application/json" }, cache: "no-store" },
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Checkout request failed with status ${response.status}`);
  }
  return parseContract(CheckoutSchema, await response.json(), "Checkout");
}

async function getJson<TResult>(
  path: string,
  schema: Parameters<typeof parseContract>[0],
  label: string,
): Promise<TResult> {
  const response = await fetch(new URL(path, webConfig.apiOrigin), {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`${path} responded ${response.status}`);
  }
  return parseContract(schema, await response.json(), label) as TResult;
}

export function fetchRotation(): Promise<RotationResponseDto> {
  return getJson("/v1/rotation", RotationSchema, "RotationResponse");
}

export function fetchRankEvents(limit = 10): Promise<RankEventListDto> {
  return getJson(`/v1/rank-events?limit=${limit}`, RankEventListSchema, "RankEventList");
}

/**
 * A live surface must never take the whole page down.
 *
 * The rotation and the ticker are supporting cast: if either is unavailable the
 * ranking is still correct and still worth showing, so a failure renders nothing
 * instead of an error page.
 */
export async function loadOptional<TResult>(load: () => Promise<TResult>): Promise<TResult | null> {
  try {
    return await load();
  } catch (error) {
    console.error("optional_surface_failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}
