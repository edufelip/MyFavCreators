import type { ProductConfig } from "@creator-outdoor/config";
import type { CreatorDetailDto } from "@creator-outdoor/contracts";
import {
  countChampionWeeks,
  type Database,
  findCreatorBySlug,
  getCreatorStanding,
} from "@creator-outdoor/db";
import { getWeeklyPeriod, isPubliclyEligible } from "@creator-outdoor/domain";
import { serializeCreatorDetail } from "../serializers/creators";

/**
 * The public creator page.
 *
 * Returns `null` for anything that is not APPROVED. A pending, rejected,
 * removed or opted-out creator is indistinguishable from one that never
 * existed, so the endpoint cannot be used to discover the moderation queue.
 */
export async function getPublicCreatorDetail(
  database: Database,
  product: ProductConfig,
  slug: string,
  now: Date,
): Promise<CreatorDetailDto | null> {
  const creator = await findCreatorBySlug(database, slug);
  if (creator === null || !isPubliclyEligible(creator.moderationStatus)) {
    return null;
  }

  const period = getWeeklyPeriod(now, product.timezone);
  const [weekly, allTime, championWeeks] = await Promise.all([
    getCreatorStanding(database, creator.id, {
      startsAt: period.startsAt,
      endsAt: period.endsAt,
    }),
    getCreatorStanding(database, creator.id, null),
    countChampionWeeks(database, creator.id),
  ]);

  return serializeCreatorDetail({
    creator,
    weekly,
    allTime,
    period,
    minIncrementCents: product.minIncrementCents,
    minBoostCents: product.minBoostCents,
    championWeeks,
  });
}
