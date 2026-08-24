import type { MoneyCents } from "@creator-outdoor/domain";
import { and, asc, desc, eq, notInArray, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../client";
import {
  optionalString,
  requireDate,
  requireInteger,
  requireMoneyCents,
  requireRecord,
  requireString,
} from "../row";
import { creatorRankingSnapshots, creators, rankEvents, rankingPeriods } from "../schema";

export type RankingPeriodRecord = {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: "OPEN" | "CLOSED";
  readonly closedAt: Date | null;
};

/**
 * Gets or creates the weekly period row for a window.
 *
 * The current week is *computed* from the instant, never read from here — this
 * row exists so a closed period can be snapshotted and referenced. The unique
 * index on (type, starts_at, ends_at) makes the upsert idempotent, so a rollover
 * that runs twice, or two requests racing, still produce one row.
 */
export async function ensureWeeklyPeriod(
  executor: DatabaseExecutor,
  window: { readonly startsAt: Date; readonly endsAt: Date },
): Promise<RankingPeriodRecord> {
  await executor
    .insert(rankingPeriods)
    .values({
      type: "WEEKLY",
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      status: "OPEN",
    })
    .onConflictDoNothing();

  const rows = await executor
    .select({
      id: rankingPeriods.id,
      startsAt: rankingPeriods.startsAt,
      endsAt: rankingPeriods.endsAt,
      status: rankingPeriods.status,
      closedAt: rankingPeriods.closedAt,
    })
    .from(rankingPeriods)
    .where(
      and(
        eq(rankingPeriods.type, "WEEKLY"),
        eq(rankingPeriods.startsAt, window.startsAt),
        eq(rankingPeriods.endsAt, window.endsAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new Error("Failed to resolve the weekly ranking period");
  }
  return row;
}

export async function findWeeklyPeriod(
  executor: DatabaseExecutor,
  window: { readonly startsAt: Date; readonly endsAt: Date },
): Promise<RankingPeriodRecord | null> {
  const rows = await executor
    .select({
      id: rankingPeriods.id,
      startsAt: rankingPeriods.startsAt,
      endsAt: rankingPeriods.endsAt,
      status: rankingPeriods.status,
      closedAt: rankingPeriods.closedAt,
    })
    .from(rankingPeriods)
    .where(
      and(
        eq(rankingPeriods.type, "WEEKLY"),
        eq(rankingPeriods.startsAt, window.startsAt),
        eq(rankingPeriods.endsAt, window.endsAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export type SnapshotRow = {
  readonly creatorId: string;
  readonly rank: number;
  readonly amountCents: MoneyCents;
  readonly supporterCount: number;
};

/**
 * Replaces a period's snapshots with the ranking as it stands now.
 *
 * Idempotent by construction: the unique index on (creator_id,
 * ranking_period_id) turns a repeated rollover into an update rather than a
 * duplicate, and creators who no longer rank in the period are deleted. That
 * second part is what makes a refund arriving weeks later correct the Hall da
 * Fama instead of leaving a stale champion.
 */
export async function replacePeriodSnapshots(
  executor: DatabaseExecutor,
  rankingPeriodId: string,
  rows: readonly SnapshotRow[],
): Promise<void> {
  const now = new Date();
  if (rows.length > 0) {
    await executor
      .insert(creatorRankingSnapshots)
      .values(
        rows.map((row) => ({
          creatorId: row.creatorId,
          rankingPeriodId,
          amountCents: row.amountCents,
          supporterCount: row.supporterCount,
          rank: row.rank,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [creatorRankingSnapshots.creatorId, creatorRankingSnapshots.rankingPeriodId],
        set: {
          amountCents: sql`excluded.amount_cents`,
          supporterCount: sql`excluded.supporter_count`,
          rank: sql`excluded.rank`,
          updatedAt: now,
        },
      });
  }

  // Creators who no longer rank in this period lose their snapshot, which is
  // what lets a refund arriving weeks later correct the Hall da Fama.
  const keptIds = rows.map((row) => row.creatorId);
  await executor
    .delete(creatorRankingSnapshots)
    .where(
      keptIds.length === 0
        ? eq(creatorRankingSnapshots.rankingPeriodId, rankingPeriodId)
        : and(
            eq(creatorRankingSnapshots.rankingPeriodId, rankingPeriodId),
            notInArray(creatorRankingSnapshots.creatorId, keptIds),
          ),
    );
}

export async function closePeriod(
  executor: DatabaseExecutor,
  rankingPeriodId: string,
  closedAt: Date,
): Promise<void> {
  await executor
    .update(rankingPeriods)
    .set({ status: "CLOSED", closedAt })
    .where(eq(rankingPeriods.id, rankingPeriodId));
}

export type ChampionRecord = {
  readonly creatorId: string;
  readonly slug: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly categorySlug: string;
  readonly categoryName: string;
  readonly primaryPlatform: string | null;
  readonly primaryHandle: string | null;
  readonly amountCents: MoneyCents;
  readonly supporterCount: number;
  readonly periodStartsAt: Date;
  readonly periodEndsAt: Date;
};

/** The champion of the most recently closed period, read from its snapshot. */
export async function findLatestChampion(
  executor: DatabaseExecutor,
): Promise<ChampionRecord | null> {
  const result: unknown[] = await executor.execute(sql`
    select
      c.id::text as creator_id,
      c.slug as slug,
      c.display_name as display_name,
      c.avatar_url as avatar_url,
      cat.slug as category_slug,
      cat.name as category_name,
      link.platform as primary_platform,
      link.handle as primary_handle,
      s.amount_cents as amount_cents,
      s.supporter_count as supporter_count,
      rp.starts_at as period_starts_at,
      rp.ends_at as period_ends_at
    from creator_ranking_snapshots s
    inner join ranking_periods rp on rp.id = s.ranking_period_id
    inner join creators c on c.id = s.creator_id
    inner join categories cat on cat.id = c.category_id
    left join lateral (
      select cl.platform, cl.handle
      from creator_links cl
      where cl.creator_id = c.id
      order by cl.is_primary desc, cl.created_at asc
      limit 1
    ) link on true
    where rp.status = 'CLOSED' and rp.type = 'WEEKLY' and s.rank = 1
      and c.moderation_status = 'APPROVED'
    order by rp.ends_at desc
    limit 1
  `);
  const first = result[0];
  if (first === undefined) {
    return null;
  }
  const row = requireRecord(first);
  return {
    creatorId: requireString(row, "creator_id"),
    slug: requireString(row, "slug"),
    displayName: requireString(row, "display_name"),
    avatarUrl: optionalString(row, "avatar_url"),
    categorySlug: requireString(row, "category_slug"),
    categoryName: requireString(row, "category_name"),
    primaryPlatform: optionalString(row, "primary_platform"),
    primaryHandle: optionalString(row, "primary_handle"),
    amountCents: requireMoneyCents(row, "amount_cents"),
    supporterCount: requireInteger(row, "supporter_count"),
    periodStartsAt: requireDate(row, "period_starts_at"),
    periodEndsAt: requireDate(row, "period_ends_at"),
  };
}

export async function listClosedPeriodsContaining(
  executor: DatabaseExecutor,
  instant: Date,
): Promise<readonly RankingPeriodRecord[]> {
  return executor
    .select({
      id: rankingPeriods.id,
      startsAt: rankingPeriods.startsAt,
      endsAt: rankingPeriods.endsAt,
      status: rankingPeriods.status,
      closedAt: rankingPeriods.closedAt,
    })
    .from(rankingPeriods)
    .where(
      and(
        eq(rankingPeriods.type, "WEEKLY"),
        sql`${rankingPeriods.startsAt} <= ${instant}`,
        sql`${rankingPeriods.endsAt} > ${instant}`,
      ),
    );
}

export type RankEventRecord = {
  readonly id: string;
  readonly creatorSlug: string;
  readonly creatorDisplayName: string;
  readonly passedCreatorSlug: string | null;
  readonly passedCreatorDisplayName: string | null;
  readonly fromRank: number;
  readonly toRank: number;
  readonly createdAt: Date;
};

export async function insertRankEvents(
  executor: DatabaseExecutor,
  rankingPeriodId: string,
  events: ReadonlyArray<{
    readonly creatorId: string;
    readonly passedCreatorId: string | null;
    readonly fromRank: number;
    readonly toRank: number;
  }>,
): Promise<readonly string[]> {
  if (events.length === 0) {
    return [];
  }
  const inserted = await executor
    .insert(rankEvents)
    .values(
      events.map((event) => ({
        rankingPeriodId,
        creatorId: event.creatorId,
        passedCreatorId: event.passedCreatorId,
        fromRank: event.fromRank,
        toRank: event.toRank,
      })),
    )
    .returning({ id: rankEvents.id });
  return inserted.map((row) => row.id);
}

/** The overtake ticker. Secondary data: never an input to any ranking. */
export async function listRecentRankEvents(
  executor: DatabaseExecutor,
  rankingPeriodId: string,
  limit: number,
): Promise<readonly RankEventRecord[]> {
  const passed = sql`passed`;
  const rows = await executor
    .select({
      id: rankEvents.id,
      creatorSlug: creators.slug,
      creatorDisplayName: creators.displayName,
      fromRank: rankEvents.fromRank,
      toRank: rankEvents.toRank,
      createdAt: rankEvents.createdAt,
      passedCreatorSlug: sql<string | null>`${passed}.slug`,
      passedCreatorDisplayName: sql<string | null>`${passed}.display_name`,
    })
    .from(rankEvents)
    .innerJoin(creators, eq(creators.id, rankEvents.creatorId))
    .leftJoin(sql`creators as passed`, sql`passed.id = ${rankEvents.passedCreatorId}`)
    .where(eq(rankEvents.rankingPeriodId, rankingPeriodId))
    .orderBy(desc(rankEvents.createdAt))
    .limit(limit);
  return rows;
}

export async function listPeriodSnapshots(
  executor: DatabaseExecutor,
  rankingPeriodId: string,
  limit: number,
) {
  return executor
    .select({
      creatorId: creatorRankingSnapshots.creatorId,
      rank: creatorRankingSnapshots.rank,
      amountCents: creatorRankingSnapshots.amountCents,
      supporterCount: creatorRankingSnapshots.supporterCount,
      creatorSlug: creators.slug,
      creatorDisplayName: creators.displayName,
      avatarUrl: creators.avatarUrl,
    })
    .from(creatorRankingSnapshots)
    .innerJoin(creators, eq(creators.id, creatorRankingSnapshots.creatorId))
    .where(eq(creatorRankingSnapshots.rankingPeriodId, rankingPeriodId))
    .orderBy(asc(creatorRankingSnapshots.rank))
    .limit(limit);
}
