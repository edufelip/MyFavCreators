import type { ProductConfig } from "@creator-outdoor/config";
import type { RotationResponseDto } from "@creator-outdoor/contracts";
import { type Database, listRotationEligibleCreators } from "@creator-outdoor/db";
import { getWeeklyPeriod, rotationBucket, selectRotation } from "@creator-outdoor/domain";

/**
 * The *Impulsionados agora* feed.
 *
 * The database supplies everyone still entitled, deliberately unordered; the
 * domain decides who is shown. Keeping the choice out of SQL is what keeps the
 * feed honest: no `order by amount`, no `order by confirmed_at desc`, nothing
 * that would quietly turn a 24-hour entitlement into "the most recent thirty".
 */
export async function getRotation(
  database: Database,
  product: ProductConfig,
  now: Date,
): Promise<RotationResponseDto> {
  const period = getWeeklyPeriod(now, product.timezone);
  const eligible = await listRotationEligibleCreators(database, now, {
    startsAt: period.startsAt,
    endsAt: period.endsAt,
  });

  const selected = selectRotation({
    candidates: eligible.map((creator) => ({
      creatorId: creator.creatorId,
      rotationEndsAt: creator.rotationEndsAt,
    })),
    now,
    bucketMinutes: product.rotationBucketMinutes,
    maxVisible: product.rotationFeedMax,
  });

  const byId = new Map(eligible.map((creator) => [creator.creatorId, creator]));

  return {
    entries: selected.flatMap((candidate) => {
      const creator = byId.get(candidate.creatorId);
      return creator === undefined
        ? []
        : [
            {
              creator: {
                id: creator.creatorId,
                slug: creator.slug,
                displayName: creator.displayName,
                avatarUrl: creator.avatarUrl,
                category: { slug: creator.categorySlug, name: creator.categoryName },
                primaryPlatform: creator.primaryPlatform,
                primaryHandle: creator.primaryHandle,
              },
              weeklyAmountCents: creator.weeklyAmountCents,
              rotationEndsAt: creator.rotationEndsAt.toISOString(),
            },
          ];
    }),
    eligibleCount: eligible.length,
    generatedAt: now.toISOString(),
    bucket: rotationBucket(now, product.rotationBucketMinutes),
  };
}
