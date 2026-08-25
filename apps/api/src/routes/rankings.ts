import type { ProductConfig } from "@creator-outdoor/config";
import {
  CategoryListDto,
  LEADERBOARD_DEFAULT_LIMIT,
  LeaderboardResponseDto,
  Slug,
} from "@creator-outdoor/contracts";
import { type Database, listActiveCategories } from "@creator-outdoor/db";
import { Elysia, t } from "elysia";
import { getAllTimeLeaderboard, getWeeklyLeaderboard } from "../services/rankings";

/**
 * Every query parameter is validated at the boundary. Frontend types are never
 * treated as runtime validation.
 */
const leaderboardQuery = t.Object({
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: LEADERBOARD_DEFAULT_LIMIT })),
  offset: t.Optional(t.Integer({ minimum: 0, maximum: 10_000, default: 0 })),
  category: t.Optional(Slug),
});

export type RankingRouteDependencies = {
  readonly database: Database;
  readonly product: ProductConfig;
  readonly now?: () => Date;
};

export function rankingRoutes(dependencies: RankingRouteDependencies) {
  const now = dependencies.now ?? (() => new Date());

  return new Elysia({ prefix: "/v1/rankings" })
    .get(
      "/weekly",
      ({ query }) =>
        getWeeklyLeaderboard(dependencies.database, dependencies.product, {
          limit: query.limit ?? LEADERBOARD_DEFAULT_LIMIT,
          offset: query.offset ?? 0,
          categorySlug: query.category,
          now: now(),
        }),
      { query: leaderboardQuery, response: LeaderboardResponseDto },
    )
    .get(
      "/all-time",
      ({ query }) =>
        getAllTimeLeaderboard(dependencies.database, dependencies.product, {
          limit: query.limit ?? LEADERBOARD_DEFAULT_LIMIT,
          offset: query.offset ?? 0,
          categorySlug: query.category,
          now: now(),
        }),
      { query: leaderboardQuery, response: LeaderboardResponseDto },
    );
}

/**
 * The categories a visitor can browse.
 *
 * Its own tiny surface rather than a field on the leaderboard: the list changes
 * roughly never, and a page that only needs the names should not have to ask
 * for a ranking to get them.
 */
export function categoryRoutes(dependencies: { readonly database: Database }) {
  return new Elysia().get(
    "/v1/categories",
    async () => {
      const categories = await listActiveCategories(dependencies.database);
      return {
        categories: categories.map((category) => ({
          slug: category.slug,
          name: category.name,
        })),
      };
    },
    { response: CategoryListDto },
  );
}
