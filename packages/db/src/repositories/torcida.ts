import { type MoneyCents, moneyCents } from "@creator-outdoor/domain";
import { sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../client";
import {
  optionalString,
  requireBoolean,
  requireDate,
  requireInteger,
  requireMoneyCents,
  requireRecord,
  requireString,
} from "../row";

/** `null` reads the all-time wall, which needs no period row to exist. */
export type TorcidaWindow = { readonly startsAt: Date; readonly endsAt: Date } | null;

export type TorcidaEntryRow = {
  readonly id: string;
  readonly supporterName: string | null;
  readonly message: string | null;
  readonly anonymous: boolean;
  readonly amountCents: MoneyCents;
  readonly boostCount: number;
  readonly lastBoostAt: Date;
};

export type TorcidaPage = {
  readonly entries: readonly TorcidaEntryRow[];
  readonly supporterCount: number;
  readonly totalAmountCents: MoneyCents;
  readonly total: number;
};

export type TorcidaQuery = {
  readonly creatorId: string;
  readonly window: TorcidaWindow;
  readonly limit: number;
  readonly offset: number;
};

/**
 * A creator's supporter wall.
 *
 * Derived from the same boosts the ranking counts — `ACTIVE` boost, `CONFIRMED`
 * payment, confirmation inside the window — so a refunded boost leaves the wall
 * for exactly the reason it leaves the score. Nothing is stored twice.
 *
 * Rows are grouped by supporter **and by whether the boost was anonymous**.
 * Grouping on the supporter alone would fold an anonymous boost into a named
 * row and publish, under a name, an amount its payer asked not to have
 * attributed to them. One person who chose anonymity for part of their boosts
 * therefore occupies two rows while still counting as one supporter — which is
 * why `supporterCount` is computed separately rather than read off the rows.
 *
 * `id` is an HMAC-free hash over the creator and the grouping key: stable for
 * this creator, useless anywhere else, so a supporter cannot be followed across
 * profiles by comparing wall ids.
 */
export async function getTorcidaPage(
  executor: DatabaseExecutor,
  query: TorcidaQuery,
): Promise<TorcidaPage> {
  const windowFilter =
    query.window === null
      ? sql``
      : sql` and p.confirmed_at >= ${query.window.startsAt} and p.confirmed_at < ${query.window.endsAt}`;

  const result: unknown[] = await executor.execute(sql`
    with contribution as (
      select
        coalesce(b.fan_identity_key, 'boost:' || b.id::text) as supporter_key,
        b.anonymous as anonymous,
        b.supporter_name as supporter_name,
        b.supporter_message as supporter_message,
        b.amount_cents as amount_cents,
        p.confirmed_at as confirmed_at
      from boosts b
      inner join payments p on p.id = b.payment_id
      where b.creator_id = ${query.creatorId}
        and b.status = 'ACTIVE'
        and p.status = 'CONFIRMED'
        and p.confirmed_at is not null${windowFilter}
    ),
    grouped as (
      select
        supporter_key,
        anonymous,
        sum(amount_cents)::bigint as amount_cents,
        count(*)::int as boost_count,
        max(confirmed_at) as last_boost_at,
        /*
         * The most recent boost that actually carried a name wins, so a
         * supporter who named themselves once and then boosted without a name
         * keeps the name they chose.
         */
        (array_agg(supporter_name order by (supporter_name is null), confirmed_at desc))[1]
          as supporter_name,
        (array_agg(supporter_message order by (supporter_message is null), confirmed_at desc))[1]
          as supporter_message
      from contribution
      group by supporter_key, anonymous
    ),
    totals as (
      select
        count(distinct supporter_key)::int as supporter_count,
        coalesce(sum(amount_cents), 0)::bigint as total_amount_cents
      from contribution
    ),
    page as (
      select
        encode(
          sha256(convert_to(${query.creatorId} || ':' || supporter_key || ':' || anonymous::text, 'UTF8')),
          'hex'
        ) as id,
        /* An anonymous row never carries a name, whatever the column holds. */
        case when anonymous then null else supporter_name end as supporter_name,
        supporter_message,
        anonymous,
        amount_cents,
        boost_count,
        last_boost_at,
        (count(*) over ())::int as total
      from grouped
      order by amount_cents desc, last_boost_at asc, id asc
      limit ${query.limit}
      offset ${query.offset}
    )
    select
      page.*,
      totals.supporter_count as supporter_count,
      totals.total_amount_cents as total_amount_cents
    from totals
    left join page on true
  `);

  const rows = result.map(requireRecord);
  const first = rows[0];
  if (first === undefined) {
    return { entries: [], supporterCount: 0, totalAmountCents: moneyCents(0), total: 0 };
  }

  const supporterCount = requireInteger(first, "supporter_count");
  const totalAmountCents = requireMoneyCents(first, "total_amount_cents");
  // `left join page on true` yields one all-null page row when the wall is empty
  // or the offset is past the end, which is a page of zero entries, not one.
  if (first["id"] === null || first["id"] === undefined) {
    return { entries: [], supporterCount, totalAmountCents, total: 0 };
  }

  return {
    entries: rows.map((row) => ({
      id: requireString(row, "id"),
      supporterName: optionalString(row, "supporter_name"),
      message: optionalString(row, "supporter_message"),
      anonymous: requireBoolean(row, "anonymous"),
      amountCents: requireMoneyCents(row, "amount_cents"),
      boostCount: requireInteger(row, "boost_count"),
      lastBoostAt: requireDate(row, "last_boost_at"),
    })),
    supporterCount,
    totalAmountCents,
    total: requireInteger(first, "total"),
  };
}
