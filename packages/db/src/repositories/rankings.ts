import { CREATOR_PLATFORMS, type CreatorPlatform, type MoneyCents } from "@creator-outdoor/domain";
import { type SQL, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../client";
import {
  optionalDate,
  optionalEnum,
  optionalString,
  requireDate,
  requireInteger,
  requireMoneyCents,
  requireRecord,
  requireString,
} from "../row";

/** `null` selects the all-time ranking, which needs no period row to exist. */
export type LeaderboardWindow = { readonly startsAt: Date; readonly endsAt: Date } | null;

export type LeaderboardQuery = {
  readonly window: LeaderboardWindow;
  readonly limit: number;
  readonly offset: number;
  readonly categorySlug?: string | undefined;
};

export type LeaderboardRow = {
  readonly rank: number;
  readonly creatorId: string;
  readonly creatorSlug: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly creatorCreatedAt: Date;
  readonly categorySlug: string;
  readonly categoryName: string;
  readonly primaryPlatform: CreatorPlatform | null;
  readonly primaryHandle: string | null;
  readonly amountCents: MoneyCents;
  readonly reachedCurrentScoreAt: Date | null;
  readonly supporterCount: number;
};

export type LeaderboardPage = {
  readonly entries: readonly LeaderboardRow[];
  /** The creator at #1, resolved independently of pagination. */
  readonly leader: LeaderboardRow | null;
  readonly total: number;
};

function windowFilter(window: LeaderboardWindow): SQL {
  if (window === null) {
    return sql``;
  }
  return sql` and p.confirmed_at >= ${window.startsAt} and p.confirmed_at < ${window.endsAt}`;
}

function categoryFilter(categorySlug: string | undefined): SQL {
  return categorySlug === undefined ? sql`` : sql` and cat.slug = ${categorySlug}`;
}

function toLeaderboardRow(value: unknown): LeaderboardRow {
  const row = requireRecord(value);
  return {
    rank: requireInteger(row, "rank"),
    creatorId: requireString(row, "creator_id"),
    creatorSlug: requireString(row, "creator_slug"),
    displayName: requireString(row, "display_name"),
    avatarUrl: optionalString(row, "avatar_url"),
    creatorCreatedAt: requireDate(row, "creator_created_at"),
    categorySlug: requireString(row, "category_slug"),
    categoryName: requireString(row, "category_name"),
    primaryPlatform: optionalEnum(row, "primary_platform", CREATOR_PLATFORMS),
    primaryHandle: optionalString(row, "primary_handle"),
    amountCents: requireMoneyCents(row, "amount_cents"),
    reachedCurrentScoreAt: optionalDate(row, "reached_current_score_at"),
    supporterCount: requireInteger(row, "supporter_count"),
  };
}

/**
 * The ranking query.
 *
 * Money is the only signal. A boost counts only while it is ACTIVE and its
 * payment remains CONFIRMED, which is why a refund simply removes the row from
 * `contribution` and the score, the tie-break timestamp and the rank all fall
 * back on their own — no denormalized score column has to be corrected.
 *
 * `reached_current_score_at` is the most recent confirmation among the boosts
 * that still count, so R$50 at 10:00 plus R$50 at 11:00 is R$100 reached at
 * 11:00, and refunding the 11:00 boost restores R$50 reached at 10:00.
 *
 * PostgreSQL does the set-based work: no ranking is ever computed by pulling
 * boosts into application memory.
 *
 * This function deliberately touches no analytics table. Impressions, outbound
 * clicks, CTR and external engagement are not ranking inputs.
 */
export async function getLeaderboardPage(
  executor: DatabaseExecutor,
  query: LeaderboardQuery,
): Promise<LeaderboardPage> {
  const firstRank = query.offset + 1;
  const lastRank = query.offset + query.limit;

  const statement = sql`
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
        and p.confirmed_at is not null${windowFilter(query.window)}
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
        c.id::text as creator_id,
        c.slug as creator_slug,
        c.display_name as display_name,
        c.avatar_url as avatar_url,
        c.created_at as creator_created_at,
        cat.slug as category_slug,
        cat.name as category_name,
        link.platform as primary_platform,
        link.handle as primary_handle,
        s.amount_cents as amount_cents,
        s.reached_current_score_at as reached_current_score_at,
        s.supporter_count as supporter_count,
        (row_number() over (
          order by
            s.amount_cents desc,
            s.reached_current_score_at asc,
            c.created_at asc,
            c.id asc
        ))::int as rank,
        (count(*) over ())::int as total
      from score s
      inner join creators c on c.id = s.creator_id
      inner join categories cat on cat.id = c.category_id
      left join lateral (
        select cl.platform, cl.handle
        from creator_links cl
        where cl.creator_id = c.id
        order by cl.is_primary desc, cl.created_at asc
        limit 1
      ) link on true
      where c.moderation_status = 'APPROVED'${categoryFilter(query.categorySlug)}
    )
    select *
    from ranked
    where rank = 1 or (rank >= ${firstRank} and rank <= ${lastRank})
    order by rank asc
  `;

  const result: unknown[] = await executor.execute(statement);
  const rows = result.map(toLeaderboardRow);
  const first = rows[0];
  const leader = first !== undefined && first.rank === 1 ? first : null;
  const entries = rows.filter((row) => row.rank >= firstRank && row.rank <= lastRank);
  const total = rows.length === 0 ? 0 : requireInteger(requireRecord(result[0]), "total");

  return { entries, leader, total };
}
