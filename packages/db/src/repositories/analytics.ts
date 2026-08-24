import { DELIVERY_SURFACES, type DeliverySurface } from "@creator-outdoor/domain";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../client";
import { requireEnum, requireInteger, requireRecord } from "../row";
import { creatorLinks, creators, impressions, outboundClicks } from "../schema";

/**
 * Delivery measurement.
 *
 * Nothing in this file is ever read by a ranking query, and nothing here can
 * change a position. Impressions and clicks record what the platform delivered;
 * money decides who ranks. Keeping the two apart is a business rule, not a
 * layering preference.
 */

export type ImpressionRecord = {
  readonly creatorId: string;
  readonly surface: DeliverySurface;
};

/**
 * Records a page's impressions, ignoring the ones already counted.
 *
 * The unique index on (creator, surface, session, hour) is what makes this
 * safe: a client that retries a beacon, or a page restored from the back/forward
 * cache, cannot inflate a creator's delivery numbers.
 *
 * Returns how many rows were genuinely new, which is the only honest answer to
 * "how many impressions did this request record".
 */
export async function recordImpressions(
  executor: DatabaseExecutor,
  input: {
    readonly sessionId: string;
    readonly hourBucket: Date;
    readonly entries: readonly ImpressionRecord[];
  },
): Promise<number> {
  if (input.entries.length === 0) {
    return 0;
  }

  const inserted = await executor
    .insert(impressions)
    .values(
      input.entries.map((entry) => ({
        creatorId: entry.creatorId,
        surface: entry.surface,
        sessionId: input.sessionId,
        hourBucket: input.hourBucket,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: impressions.id });
  return inserted.length;
}

export type OutboundLinkTarget = {
  readonly creatorId: string;
  readonly creatorSlug: string;
  readonly creatorLinkId: string;
  readonly url: string;
};

/**
 * The destination behind a tracked redirect, if it may be shown at all.
 *
 * Only a link belonging to an APPROVED creator resolves. A removed or opted-out
 * creator's links stop redirecting the moment their status changes, so the
 * redirect can never outlive the profile it points at.
 */
export async function findOutboundTarget(
  executor: DatabaseExecutor,
  creatorLinkId: string,
): Promise<OutboundLinkTarget | null> {
  const rows = await executor
    .select({
      creatorId: creatorLinks.creatorId,
      creatorSlug: creators.slug,
      creatorLinkId: creatorLinks.id,
      url: creatorLinks.url,
    })
    .from(creatorLinks)
    .innerJoin(creators, eq(creators.id, creatorLinks.creatorId))
    .where(and(eq(creatorLinks.id, creatorLinkId), eq(creators.moderationStatus, "APPROVED")))
    .limit(1);
  return rows[0] ?? null;
}

/** Records one outbound click. Returns false when this hour already had one. */
export async function recordOutboundClick(
  executor: DatabaseExecutor,
  input: {
    readonly creatorId: string;
    readonly creatorLinkId: string;
    readonly sessionId: string;
    readonly hourBucket: Date;
    readonly referrer: string | null;
  },
): Promise<boolean> {
  const inserted = await executor
    .insert(outboundClicks)
    .values({
      creatorId: input.creatorId,
      creatorLinkId: input.creatorLinkId,
      sessionId: input.sessionId,
      hourBucket: input.hourBucket,
      referrer: input.referrer,
    })
    .onConflictDoNothing()
    .returning({ id: outboundClicks.id });
  return inserted.length > 0;
}

export type DeliveryWindow = { readonly startsAt: Date; readonly endsAt: Date } | null;

export type DeliveryTotals = {
  readonly impressions: number;
  readonly clicks: number;
  readonly bySurface: ReadonlyArray<{
    readonly surface: DeliverySurface;
    readonly impressions: number;
  }>;
};

/**
 * What a creator's presence actually delivered in a window.
 *
 * Counted from the deduplicated rows, so these are distinct session-hours, not
 * raw events: the number a delivery report may honestly show.
 */
export async function getCreatorDelivery(
  executor: DatabaseExecutor,
  creatorId: string,
  window: DeliveryWindow,
): Promise<DeliveryTotals> {
  const impressionFilters = [eq(impressions.creatorId, creatorId)];
  const clickFilters = [eq(outboundClicks.creatorId, creatorId)];
  if (window !== null) {
    impressionFilters.push(
      gte(impressions.hourBucket, window.startsAt),
      lt(impressions.hourBucket, window.endsAt),
    );
    clickFilters.push(
      gte(outboundClicks.hourBucket, window.startsAt),
      lt(outboundClicks.hourBucket, window.endsAt),
    );
  }

  const [surfaceRows, clickRows] = await Promise.all([
    executor
      .select({ surface: impressions.surface, total: sql<number>`count(*)::int` })
      .from(impressions)
      .where(and(...impressionFilters))
      .groupBy(impressions.surface),
    executor
      .select({ total: sql<number>`count(*)::int` })
      .from(outboundClicks)
      .where(and(...clickFilters)),
  ]);

  const bySurface = surfaceRows.map((row) => {
    const record = requireRecord(row);
    return {
      surface: requireEnum(record, "surface", DELIVERY_SURFACES),
      impressions: requireInteger(record, "total"),
    };
  });

  return {
    impressions: bySurface.reduce((sum, row) => sum + row.impressions, 0),
    clicks: clickRows[0]?.total ?? 0,
    bySurface,
  };
}
