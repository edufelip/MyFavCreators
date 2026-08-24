import type { ProductConfig } from "@creator-outdoor/config";
import type {
  DeliveryReportDto,
  ImpressionBatchResponseDto,
  OutboundClickResponseDto,
} from "@creator-outdoor/contracts";
import {
  type Database,
  findCreatorBySlug,
  findOutboundTarget,
  getCreatorDelivery,
  recordImpressions,
  recordOutboundClick,
} from "@creator-outdoor/db";
import {
  clickThroughRate,
  getWeeklyPeriod,
  hourBucket,
  type ImpressionInput,
  isPubliclyEligible,
  validateImpressionBatch,
} from "@creator-outdoor/domain";
import { log } from "../observability/logger";

/**
 * Delivery measurement.
 *
 * Everything here is about what the platform showed. None of it is ever read by
 * a ranking query, and none of it can move a position: money is the only
 * ranking signal, and mixing the two would turn traffic into rank.
 */

export type RecordImpressionsInput = {
  readonly sessionId: string;
  readonly entries: readonly ImpressionInput[];
  readonly now: Date;
};

export async function recordImpressionBatch(
  database: Database,
  input: RecordImpressionsInput,
): Promise<ImpressionBatchResponseDto> {
  const entries = validateImpressionBatch(input.entries);
  const recorded = await recordImpressions(database, {
    sessionId: input.sessionId,
    hourBucket: hourBucket(input.now),
    entries,
  });
  return { recorded };
}

export type OutboundClickInput = {
  readonly creatorLinkId: string;
  /** `null` for a visitor with no analytics session; the click is not counted. */
  readonly sessionId: string | null;
  readonly referrer: string | null;
  readonly now: Date;
};

/**
 * Resolves a tracked redirect and counts the click.
 *
 * The destination comes from the stored link, never from the caller, so this
 * endpoint cannot be turned into an open redirect. Counting is best effort
 * relative to redirecting: a supporter following a link must not be stranded
 * because a measurement write failed.
 */
export async function resolveOutboundClick(
  database: Database,
  input: OutboundClickInput,
): Promise<OutboundClickResponseDto | null> {
  const target = await findOutboundTarget(database, input.creatorLinkId);
  if (target === null) {
    return null;
  }

  const sessionId = input.sessionId;
  let counted = false;
  try {
    counted =
      sessionId !== null &&
      (await recordOutboundClick(database, {
        creatorId: target.creatorId,
        creatorLinkId: target.creatorLinkId,
        sessionId,
        hourBucket: hourBucket(input.now),
        referrer: input.referrer,
      }));
  } catch (error) {
    log.error("outbound_click_not_recorded", error);
  }

  return { url: target.url, creatorSlug: target.creatorSlug, counted };
}

export type DeliveryReportRequest = {
  readonly slug: string;
  readonly window: "weekly" | "all-time";
  readonly now: Date;
};

/** What a creator's presence delivered. `null` when the creator is not public. */
export async function getDeliveryReport(
  database: Database,
  product: ProductConfig,
  request: DeliveryReportRequest,
): Promise<DeliveryReportDto | null> {
  const creator = await findCreatorBySlug(database, request.slug);
  if (creator === null || !isPubliclyEligible(creator.moderationStatus)) {
    return null;
  }

  const period =
    request.window === "all-time" ? null : getWeeklyPeriod(request.now, product.timezone);
  const totals = await getCreatorDelivery(
    database,
    creator.id,
    period === null ? null : { startsAt: period.startsAt, endsAt: period.endsAt },
  );

  return {
    creatorSlug: creator.slug,
    window: request.window,
    periodStartsAt: period?.startsAt.toISOString() ?? null,
    periodEndsAt: period?.endsAt.toISOString() ?? null,
    impressions: totals.impressions,
    outboundClicks: totals.clicks,
    clickThroughRate: clickThroughRate(totals.clicks, totals.impressions),
    bySurface: [...totals.bySurface].sort((left, right) => right.impressions - left.impressions),
  };
}
