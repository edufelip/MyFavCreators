import type { ProductConfig } from "@creator-outdoor/config";
import { ChampionDto, RankEventListDto, RotationResponseDto } from "@creator-outdoor/contracts";
import { type Database, findLatestChampion } from "@creator-outdoor/db";
import { isCreatorPlatform } from "@creator-outdoor/domain";
import { Elysia, t } from "elysia";
import { getRecentRankEvents } from "../services/rank-events";
import { getRotation } from "../services/rotation";

export type LiveRouteDependencies = {
  readonly database: Database;
  readonly product: ProductConfig;
  readonly now?: () => Date;
};

/** The live surfaces: rotation, overtake ticker and the previous champion. */
export function liveRoutes(dependencies: LiveRouteDependencies) {
  const now = dependencies.now ?? (() => new Date());

  return new Elysia({ prefix: "/v1" })
    .get("/rotation", () => getRotation(dependencies.database, dependencies.product, now()), {
      response: RotationResponseDto,
    })
    .get(
      "/rank-events",
      ({ query }) =>
        getRecentRankEvents(dependencies.database, dependencies.product, now(), query.limit ?? 10),
      {
        query: t.Object({
          limit: t.Optional(t.Integer({ minimum: 1, maximum: 50, default: 10 })),
        }),
        response: RankEventListDto,
      },
    )
    .get(
      "/champion",
      async () => {
        const champion = await findLatestChampion(dependencies.database);
        return champion === null
          ? null
          : {
              creator: {
                id: champion.creatorId,
                slug: champion.slug,
                displayName: champion.displayName,
                avatarUrl: champion.avatarUrl,
                category: { slug: champion.categorySlug, name: champion.categoryName },
                primaryPlatform: isCreatorPlatform(champion.primaryPlatform)
                  ? champion.primaryPlatform
                  : null,
                primaryHandle: champion.primaryHandle,
              },
              amountCents: champion.amountCents,
              supporterCount: champion.supporterCount,
              periodStartsAt: champion.periodStartsAt.toISOString(),
              periodEndsAt: champion.periodEndsAt.toISOString(),
            };
      },
      { response: t.Union([ChampionDto, t.Null()]) },
    );
}
