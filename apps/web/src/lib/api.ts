import "server-only";

import { webConfig } from "@creator-outdoor/config/web";
import {
  AcknowledgementDto,
  type CheckoutDto,
  CheckoutDto as CheckoutSchema,
  type CreateBoostRequestDto,
  type CreatorDetailDto,
  CreatorDetailDto as CreatorDetailSchema,
  type CreatorReportRequestDto,
  type CreatorSubmissionResponseDto,
  CreatorSubmissionResponseDto as CreatorSubmissionSchema,
  type LeaderboardResponseDto,
  LeaderboardResponseDto as LeaderboardSchema,
  type OptOutChallengeDto,
  OptOutChallengeDto as OptOutChallengeSchema,
  type OptOutVerificationResponseDto,
  OptOutVerificationResponseDto as OptOutVerificationSchema,
  type PaymentStatusResponseDto,
  PaymentStatusResponseDto as PaymentStatusSchema,
  parseContract,
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
