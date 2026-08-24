import "server-only";

import { webConfig } from "@creator-outdoor/config/web";
import {
  type LeaderboardResponseDto,
  LeaderboardResponseDto as LeaderboardSchema,
  parseContract,
} from "@creator-outdoor/contracts";

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
