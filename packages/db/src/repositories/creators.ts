import {
  type ClaimStatus,
  type CreatorPlatform,
  type ModerationStatus,
  type MoneyCents,
  type RejectionReason,
  ZERO_CENTS,
} from "@creator-outdoor/domain";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../client";
import { optionalDate, requireInteger, requireMoneyCents, requireRecord } from "../row";
import { categories, creatorLinks, creatorSuppressions, creators } from "../schema";

export type CreatorLinkRecord = {
  readonly id: string;
  readonly platform: CreatorPlatform;
  readonly handle: string;
  readonly url: string;
  readonly isPrimary: boolean;
};

export type CreatorRecord = {
  readonly id: string;
  readonly slug: string;
  readonly displayName: string;
  readonly bio: string | null;
  readonly avatarUrl: string | null;
  readonly categoryId: string;
  readonly categorySlug: string;
  readonly categoryName: string;
  readonly claimStatus: ClaimStatus;
  readonly moderationStatus: ModerationStatus;
  readonly rejectionReason: RejectionReason | null;
  readonly createdAt: Date;
  readonly links: readonly CreatorLinkRecord[];
};

const CREATOR_COLUMNS = {
  id: creators.id,
  slug: creators.slug,
  displayName: creators.displayName,
  bio: creators.bio,
  avatarUrl: creators.avatarUrl,
  categoryId: creators.categoryId,
  categorySlug: categories.slug,
  categoryName: categories.name,
  claimStatus: creators.claimStatus,
  moderationStatus: creators.moderationStatus,
  rejectionReason: creators.rejectionReason,
  createdAt: creators.createdAt,
} as const;

async function attachLinks(
  executor: DatabaseExecutor,
  rows: ReadonlyArray<Omit<CreatorRecord, "links">>,
): Promise<CreatorRecord[]> {
  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((row) => row.id);
  const links = await executor
    .select({
      id: creatorLinks.id,
      creatorId: creatorLinks.creatorId,
      platform: creatorLinks.platform,
      handle: creatorLinks.handle,
      url: creatorLinks.url,
      isPrimary: creatorLinks.isPrimary,
    })
    .from(creatorLinks)
    .where(inArray(creatorLinks.creatorId, ids))
    .orderBy(desc(creatorLinks.isPrimary), asc(creatorLinks.createdAt));

  const byCreator = new Map<string, CreatorLinkRecord[]>();
  for (const link of links) {
    const bucket = byCreator.get(link.creatorId) ?? [];
    bucket.push({
      id: link.id,
      platform: link.platform,
      handle: link.handle,
      url: link.url,
      isPrimary: link.isPrimary,
    });
    byCreator.set(link.creatorId, bucket);
  }
  return rows.map((row) => ({ ...row, links: byCreator.get(row.id) ?? [] }));
}

export async function findCreatorBySlug(
  executor: DatabaseExecutor,
  slug: string,
): Promise<CreatorRecord | null> {
  const rows = await executor
    .select(CREATOR_COLUMNS)
    .from(creators)
    .innerJoin(categories, eq(categories.id, creators.categoryId))
    .where(eq(creators.slug, slug))
    .limit(1);
  const withLinks = await attachLinks(executor, rows);
  return withLinks[0] ?? null;
}

export type PublicCreatorRef = {
  readonly slug: string;
  readonly updatedAt: Date;
};

/**
 * Every profile that may appear in a sitemap.
 *
 * Only APPROVED, for the same reason every other public read is: a sitemap
 * listing a pending or removed profile would publish the moderation queue and
 * would point search engines at pages that 404.
 */
export async function listPublicCreatorRefs(
  executor: DatabaseExecutor,
  limit: number,
): Promise<readonly PublicCreatorRef[]> {
  return executor
    .select({ slug: creators.slug, updatedAt: creators.updatedAt })
    .from(creators)
    .where(eq(creators.moderationStatus, "APPROVED"))
    .orderBy(desc(creators.updatedAt))
    .limit(limit);
}

export async function findCreatorById(
  executor: DatabaseExecutor,
  id: string,
): Promise<CreatorRecord | null> {
  const rows = await executor
    .select(CREATOR_COLUMNS)
    .from(creators)
    .innerJoin(categories, eq(categories.id, creators.categoryId))
    .where(eq(creators.id, id))
    .limit(1);
  const withLinks = await attachLinks(executor, rows);
  return withLinks[0] ?? null;
}

export async function findCreatorByNormalizedKey(
  executor: DatabaseExecutor,
  normalizedKey: string,
): Promise<CreatorRecord | null> {
  const rows = await executor
    .select(CREATOR_COLUMNS)
    .from(creatorLinks)
    .innerJoin(creators, eq(creators.id, creatorLinks.creatorId))
    .innerJoin(categories, eq(categories.id, creators.categoryId))
    .where(eq(creatorLinks.normalizedKey, normalizedKey))
    .limit(1);
  const withLinks = await attachLinks(executor, rows);
  return withLinks[0] ?? null;
}

export async function isNormalizedKeySuppressed(
  executor: DatabaseExecutor,
  normalizedKey: string,
): Promise<boolean> {
  const rows = await executor
    .select({ id: creatorSuppressions.id })
    .from(creatorSuppressions)
    .where(eq(creatorSuppressions.normalizedKey, normalizedKey))
    .limit(1);
  return rows.length > 0;
}

export async function suppressNormalizedKey(
  executor: DatabaseExecutor,
  normalizedKey: string,
  reason: string,
): Promise<void> {
  await executor
    .insert(creatorSuppressions)
    .values({ normalizedKey, reason })
    .onConflictDoNothing({ target: creatorSuppressions.normalizedKey });
}

export type InsertCreatorInput = {
  readonly slug: string;
  readonly displayName: string;
  readonly bio: string | null;
  readonly avatarUrl: string | null;
  readonly categoryId: string;
  readonly link: {
    readonly platform: CreatorPlatform;
    readonly handle: string;
    readonly url: string;
    readonly normalizedKey: string;
  };
};

export async function insertCreatorWithLink(
  executor: DatabaseExecutor,
  input: InsertCreatorInput,
): Promise<{ readonly id: string; readonly slug: string }> {
  const inserted = await executor
    .insert(creators)
    .values({
      slug: input.slug,
      displayName: input.displayName,
      bio: input.bio,
      avatarUrl: input.avatarUrl,
      categoryId: input.categoryId,
      // Every submission starts here. Nothing is public until a human approves it.
      moderationStatus: "PENDING_REVIEW",
    })
    .returning({ id: creators.id, slug: creators.slug });
  const creator = inserted[0];
  if (creator === undefined) {
    throw new Error("Failed to insert creator");
  }
  await executor.insert(creatorLinks).values({
    creatorId: creator.id,
    platform: input.link.platform,
    handle: input.link.handle,
    url: input.link.url,
    normalizedKey: input.link.normalizedKey,
    isPrimary: true,
  });
  return creator;
}

export async function slugExists(executor: DatabaseExecutor, slug: string): Promise<boolean> {
  const rows = await executor
    .select({ id: creators.id })
    .from(creators)
    .where(eq(creators.slug, slug))
    .limit(1);
  return rows.length > 0;
}

export type UpdateModerationInput = {
  readonly creatorId: string;
  readonly moderationStatus: ModerationStatus;
  readonly rejectionReason?: RejectionReason | null;
};

export async function updateCreatorModeration(
  executor: DatabaseExecutor,
  input: UpdateModerationInput,
): Promise<void> {
  await executor
    .update(creators)
    .set({
      moderationStatus: input.moderationStatus,
      rejectionReason: input.rejectionReason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(creators.id, input.creatorId));
}

export type UpdateCreatorMetadataInput = {
  readonly creatorId: string;
  readonly displayName?: string;
  readonly bio?: string | null;
  readonly avatarUrl?: string | null;
  readonly categoryId?: string;
};

export async function updateCreatorMetadata(
  executor: DatabaseExecutor,
  input: UpdateCreatorMetadataInput,
): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.displayName !== undefined) patch["displayName"] = input.displayName;
  if (input.bio !== undefined) patch["bio"] = input.bio;
  if (input.avatarUrl !== undefined) patch["avatarUrl"] = input.avatarUrl;
  if (input.categoryId !== undefined) patch["categoryId"] = input.categoryId;
  await executor.update(creators).set(patch).where(eq(creators.id, input.creatorId));
}

export async function listCreatorsByModeration(
  executor: DatabaseExecutor,
  moderationStatus: ModerationStatus,
  limit: number,
  offset: number,
): Promise<readonly CreatorRecord[]> {
  const rows = await executor
    .select(CREATOR_COLUMNS)
    .from(creators)
    .innerJoin(categories, eq(categories.id, creators.categoryId))
    .where(eq(creators.moderationStatus, moderationStatus))
    .orderBy(asc(creators.createdAt))
    .limit(limit)
    .offset(offset);
  return attachLinks(executor, rows);
}

export async function countCreatorsByModeration(
  executor: DatabaseExecutor,
  moderationStatus: ModerationStatus,
): Promise<number> {
  const rows = await executor
    .select({ total: sql<number>`count(*)::int` })
    .from(creators)
    .where(eq(creators.moderationStatus, moderationStatus));
  return rows[0]?.total ?? 0;
}

export type CreatorTotals = {
  readonly lifetimeAmountCents: MoneyCents;
  readonly lifetimeSupporterCount: number;
};

/**
 * Lifetime totals for one creator.
 *
 * Same rule as every ranking: only ACTIVE boosts behind CONFIRMED payments.
 * No analytics table is touched here either.
 */
export async function getCreatorLifetimeTotals(
  executor: DatabaseExecutor,
  creatorId: string,
): Promise<CreatorTotals> {
  const result: unknown[] = await executor.execute(sql`
    select
      coalesce(sum(b.amount_cents), 0)::bigint as lifetime_amount_cents,
      count(distinct coalesce(b.fan_identity_key, 'boost:' || b.id::text))::int as lifetime_supporter_count
    from boosts b
    inner join payments p on p.id = b.payment_id
    where b.creator_id = ${creatorId}
      and b.status = 'ACTIVE'
      and p.status = 'CONFIRMED'
      and p.confirmed_at is not null
  `);
  const row = requireRecord(result[0]);
  return {
    lifetimeAmountCents: requireMoneyCents(row, "lifetime_amount_cents"),
    lifetimeSupporterCount: requireInteger(row, "lifetime_supporter_count"),
  };
}

export type CreatorPeriodStanding = {
  readonly rank: number | null;
  readonly amountCents: MoneyCents;
  readonly supporterCount: number;
  readonly reachedCurrentScoreAt: Date | null;
  readonly leaderAmountCents: MoneyCents | null;
};

/**
 * Where a creator stands in a window, including the leader's score so the
 * Take #1 quote can be calculated by the domain.
 */
export async function getCreatorStanding(
  executor: DatabaseExecutor,
  creatorId: string,
  window: { readonly startsAt: Date; readonly endsAt: Date } | null,
): Promise<CreatorPeriodStanding> {
  const windowFilter =
    window === null
      ? sql``
      : sql` and p.confirmed_at >= ${window.startsAt} and p.confirmed_at < ${window.endsAt}`;

  const result: unknown[] = await executor.execute(sql`
    with contribution as (
      select
        b.creator_id as creator_id,
        b.amount_cents as amount_cents,
        p.confirmed_at as confirmed_at,
        coalesce(b.fan_identity_key, 'boost:' || b.id::text) as supporter_key
      from boosts b
      inner join payments p on p.id = b.payment_id
      where b.status = 'ACTIVE'
        and p.status = 'CONFIRMED'
        and p.confirmed_at is not null${windowFilter}
    ),
    score as (
      select
        creator_id,
        sum(amount_cents)::bigint as amount_cents,
        max(confirmed_at) as reached_current_score_at,
        count(distinct supporter_key)::int as supporter_count
      from contribution
      group by creator_id
    ),
    ranked as (
      select
        s.creator_id,
        s.amount_cents,
        s.reached_current_score_at,
        s.supporter_count,
        (row_number() over (
          order by s.amount_cents desc, s.reached_current_score_at asc, c.created_at asc, c.id asc
        ))::int as rank,
        (max(s.amount_cents) over ())::bigint as leader_amount_cents
      from score s
      inner join creators c on c.id = s.creator_id
      where c.moderation_status = 'APPROVED'
    )
    select * from ranked where creator_id = ${creatorId}
  `);

  const first = result[0];
  if (first === undefined) {
    // The creator has no counted money in this window; the leader's score still
    // matters for the Take #1 quote.
    const leaderRows: unknown[] = await executor.execute(sql`
      with contribution as (
        select b.creator_id as creator_id, b.amount_cents as amount_cents
        from boosts b
        inner join payments p on p.id = b.payment_id
        inner join creators c on c.id = b.creator_id and c.moderation_status = 'APPROVED'
        where b.status = 'ACTIVE'
          and p.status = 'CONFIRMED'
          and p.confirmed_at is not null${windowFilter}
      )
      select coalesce(max(total), 0)::bigint as leader_amount_cents
      from (select sum(amount_cents) as total from contribution group by creator_id) totals
    `);
    const leaderRow = requireRecord(leaderRows[0]);
    const leaderAmount = requireMoneyCents(leaderRow, "leader_amount_cents");
    return {
      rank: null,
      amountCents: ZERO_CENTS,
      supporterCount: 0,
      reachedCurrentScoreAt: null,
      leaderAmountCents: leaderAmount === 0 ? null : leaderAmount,
    };
  }

  const row = requireRecord(first);
  return {
    rank: requireInteger(row, "rank"),
    amountCents: requireMoneyCents(row, "amount_cents"),
    supporterCount: requireInteger(row, "supporter_count"),
    reachedCurrentScoreAt: optionalDate(row, "reached_current_score_at"),
    leaderAmountCents: requireMoneyCents(row, "leader_amount_cents"),
  };
}

export type PublicCreatorSearchResult = {
  readonly slug: string;
  readonly displayName: string;
  readonly updatedAt: Date;
};

/** Every publicly indexable creator, for the sitemap. */
export async function listPublicCreators(
  executor: DatabaseExecutor,
): Promise<readonly PublicCreatorSearchResult[]> {
  const rows = await executor
    .select({
      slug: creators.slug,
      displayName: creators.displayName,
      updatedAt: creators.updatedAt,
    })
    .from(creators)
    .where(eq(creators.moderationStatus, "APPROVED"))
    .orderBy(asc(creators.slug));
  return rows;
}

export async function findCategoryIdBySlug(
  executor: DatabaseExecutor,
  slug: string,
): Promise<string | null> {
  const rows = await executor
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function findApprovedCreatorLink(
  executor: DatabaseExecutor,
  creatorLinkId: string,
): Promise<{ readonly creatorId: string; readonly url: string } | null> {
  const rows = await executor
    .select({ creatorId: creatorLinks.creatorId, url: creatorLinks.url })
    .from(creatorLinks)
    .innerJoin(creators, eq(creators.id, creatorLinks.creatorId))
    .where(and(eq(creatorLinks.id, creatorLinkId), eq(creators.moderationStatus, "APPROVED")))
    .limit(1);
  return rows[0] ?? null;
}
