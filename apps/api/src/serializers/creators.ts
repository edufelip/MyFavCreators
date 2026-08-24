import type {
  AdminCreatorDto,
  CreatorDetailDto,
  CreatorLinkDto,
  CreatorStandingDto,
} from "@creator-outdoor/contracts";
import type { CreatorPeriodStanding, CreatorRecord } from "@creator-outdoor/db";
import { moneyCents, takeFirstPlaceQuote, type WeeklyPeriod } from "@creator-outdoor/domain";

/**
 * Outbound links always go through the tracked redirect, never straight to the
 * destination, so a click can be measured and the destination stays validated
 * server-side.
 */
function serializeLink(link: CreatorRecord["links"][number]): CreatorLinkDto {
  return {
    id: link.id,
    platform: link.platform,
    handle: link.handle,
    outboundUrl: `/out/${link.id}`,
    isPrimary: link.isPrimary,
  };
}

function serializeStanding(
  standing: CreatorPeriodStanding,
  minIncrementCents: number,
  minBoostCents: number,
): CreatorStandingDto {
  const isCurrentLeader = standing.rank === 1;
  const takeFirstPlaceAmountCents =
    standing.leaderAmountCents === null
      ? null
      : takeFirstPlaceQuote({
          leaderAmountCents: standing.leaderAmountCents,
          creatorAmountCents: standing.amountCents,
          minIncrementCents: moneyCents(minIncrementCents),
          minBoostCents: moneyCents(minBoostCents),
          isCurrentLeader,
        });
  return {
    rank: standing.rank,
    amountCents: standing.amountCents,
    supporterCount: standing.supporterCount,
    takeFirstPlaceAmountCents,
  };
}

export type SerializeCreatorDetailInput = {
  readonly creator: CreatorRecord;
  readonly weekly: CreatorPeriodStanding;
  readonly allTime: CreatorPeriodStanding;
  readonly period: WeeklyPeriod;
  readonly minIncrementCents: number;
  readonly minBoostCents: number;
};

/**
 * The public creator page.
 *
 * An explicit allowlist. `moderationStatus`, `rejectionReason`, normalized keys
 * and raw destination URLs are all absent by construction.
 */
export function serializeCreatorDetail(input: SerializeCreatorDetailInput): CreatorDetailDto {
  return {
    id: input.creator.id,
    slug: input.creator.slug,
    displayName: input.creator.displayName,
    bio: input.creator.bio,
    avatarUrl: input.creator.avatarUrl,
    category: { slug: input.creator.categorySlug, name: input.creator.categoryName },
    claimStatus: input.creator.claimStatus,
    links: input.creator.links.map(serializeLink),
    weekly: serializeStanding(input.weekly, input.minIncrementCents, input.minBoostCents),
    allTime: serializeStanding(input.allTime, input.minIncrementCents, input.minBoostCents),
    period: {
      startsAt: input.period.startsAt.toISOString(),
      endsAt: input.period.endsAt.toISOString(),
    },
    createdAt: input.creator.createdAt.toISOString(),
  };
}

/** The administration view, which may show moderation state the public never sees. */
export function serializeAdminCreator(creator: CreatorRecord): AdminCreatorDto {
  return {
    id: creator.id,
    slug: creator.slug,
    displayName: creator.displayName,
    bio: creator.bio,
    avatarUrl: creator.avatarUrl,
    category: { slug: creator.categorySlug, name: creator.categoryName },
    claimStatus: creator.claimStatus,
    moderationStatus: creator.moderationStatus,
    rejectionReason: creator.rejectionReason,
    links: creator.links.map(serializeLink),
    createdAt: creator.createdAt.toISOString(),
  };
}
