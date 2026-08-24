import type { CreatorPlatform } from "@creator-outdoor/domain";
import { sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../client";
import {
  optionalEnum,
  optionalString,
  requireDate,
  requireMoneyCents,
  requireRecord,
  requireString,
} from "../row";

const PLATFORM_VALUES = [
  "INSTAGRAM",
  "TIKTOK",
  "YOUTUBE",
  "TWITCH",
  "X",
  "SPOTIFY",
  "SUBSTACK",
  "WEBSITE",
] as const;

export type RotationEligibleCreator = {
  readonly creatorId: string;
  readonly slug: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly categorySlug: string;
  readonly categoryName: string;
  readonly primaryPlatform: CreatorPlatform | null;
  readonly primaryHandle: string | null;
  /** The latest expiry among the creator's active boosts. */
  readonly rotationEndsAt: Date;
  readonly weeklyAmountCents: import("@creator-outdoor/domain").MoneyCents;
};

/**
 * Every creator still entitled to appear in the rotation.
 *
 * Entitlement is one row per creator no matter how many boosts they hold: the
 * maximum active `rotation_ends_at` decides, so ten boosts produce one entry
 * rather than ten. Which of these actually appear is decided by the domain's
 * fair selection, not by this query — so the SQL deliberately does no ordering
 * by amount, recency, or anything else that would bias the feed.
 */
export async function listRotationEligibleCreators(
  executor: DatabaseExecutor,
  now: Date,
  window: { readonly startsAt: Date; readonly endsAt: Date },
): Promise<readonly RotationEligibleCreator[]> {
  const result: unknown[] = await executor.execute(sql`
    with entitlement as (
      select b.creator_id as creator_id, max(b.rotation_ends_at) as rotation_ends_at
      from boosts b
      inner join payments p on p.id = b.payment_id
      where b.status = 'ACTIVE'
        and p.status = 'CONFIRMED'
        and b.rotation_ends_at is not null
        and b.rotation_ends_at > ${now}
      group by b.creator_id
    ),
    weekly as (
      select b.creator_id as creator_id, sum(b.amount_cents)::bigint as amount_cents
      from boosts b
      inner join payments p on p.id = b.payment_id
      where b.status = 'ACTIVE'
        and p.status = 'CONFIRMED'
        and p.confirmed_at >= ${window.startsAt}
        and p.confirmed_at < ${window.endsAt}
      group by b.creator_id
    )
    select
      c.id::text as creator_id,
      c.slug as slug,
      c.display_name as display_name,
      c.avatar_url as avatar_url,
      cat.slug as category_slug,
      cat.name as category_name,
      link.platform as primary_platform,
      link.handle as primary_handle,
      e.rotation_ends_at as rotation_ends_at,
      coalesce(w.amount_cents, 0)::bigint as weekly_amount_cents
    from entitlement e
    inner join creators c on c.id = e.creator_id
    inner join categories cat on cat.id = c.category_id
    left join weekly w on w.creator_id = e.creator_id
    left join lateral (
      select cl.platform, cl.handle
      from creator_links cl
      where cl.creator_id = c.id
      order by cl.is_primary desc, cl.created_at asc
      limit 1
    ) link on true
    where c.moderation_status = 'APPROVED'
  `);

  return result.map((value) => {
    const row = requireRecord(value);
    return {
      creatorId: requireString(row, "creator_id"),
      slug: requireString(row, "slug"),
      displayName: requireString(row, "display_name"),
      avatarUrl: optionalString(row, "avatar_url"),
      categorySlug: requireString(row, "category_slug"),
      categoryName: requireString(row, "category_name"),
      primaryPlatform: optionalEnum(row, "primary_platform", PLATFORM_VALUES),
      primaryHandle: optionalString(row, "primary_handle"),
      rotationEndsAt: requireDate(row, "rotation_ends_at"),
      weeklyAmountCents: requireMoneyCents(row, "weekly_amount_cents"),
    };
  });
}
