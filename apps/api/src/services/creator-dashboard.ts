import type { ProductConfig } from "@creator-outdoor/config";
import type { CreatorDashboardDto } from "@creator-outdoor/contracts";
import {
  type ClaimedCreator,
  countChampionWeeks,
  type Database,
  findCreatorById,
  getCreatorDelivery,
  getCreatorStanding,
  hasActiveSubscription,
} from "@creator-outdoor/db";
import { centsValue, clickThroughRate, getWeeklyPeriod } from "@creator-outdoor/domain";

/**
 * What a claimed creator sees about their own profile.
 *
 * Deliberately the same numbers the public sees plus the delivery measurement
 * and their own notification setting — there is no private ranking, no hidden
 * score and no second version of the truth. The product's whole claim is that
 * money is the only signal and the ranking is not a secret algorithm; a
 * dashboard showing something the public page does not would undo that.
 */
export async function getCreatorDashboard(
  database: Database,
  product: ProductConfig,
  claimed: ClaimedCreator,
  now: Date,
): Promise<CreatorDashboardDto | null> {
  const creator = await findCreatorById(database, claimed.creatorId);
  if (creator === null) {
    return null;
  }

  const period = getWeeklyPeriod(now, product.timezone);
  const window = { startsAt: period.startsAt, endsAt: period.endsAt };

  const [weekly, allTime, delivery, championWeeks, notifyDethrone] = await Promise.all([
    getCreatorStanding(database, creator.id, window),
    getCreatorStanding(database, creator.id, null),
    getCreatorDelivery(database, creator.id, null),
    countChampionWeeks(database, creator.id),
    claimed.email === null
      ? Promise.resolve(false)
      : hasActiveSubscription(database, {
          email: claimed.email,
          creatorId: creator.id,
          type: "DETHRONE",
        }),
  ]);

  return {
    creatorSlug: creator.slug,
    displayName: creator.displayName,
    bio: creator.bio,
    categorySlug: creator.categorySlug,
    weeklyRank: weekly.rank,
    weeklyAmountCents: centsValue(weekly.amountCents),
    allTimeAmountCents: centsValue(allTime.amountCents),
    supporterCount: allTime.supporterCount,
    impressions: delivery.impressions,
    outboundClicks: delivery.clicks,
    clickThroughRate: clickThroughRate(delivery.clicks, delivery.impressions),
    championWeeks,
    notifyDethrone,
  };
}
