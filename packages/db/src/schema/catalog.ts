import { boolean, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, primaryKeyColumn, timestampColumn, updatedAtColumn } from "./columns";
import {
  claimStatusEnum,
  creatorPlatformEnum,
  moderationStatusEnum,
  rejectionReasonEnum,
  reportStatusEnum,
} from "./enums";

export const categories = pgTable(
  "categories",
  {
    id: primaryKeyColumn(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** Only active categories render publicly. */
    isActive: boolean("is_active").notNull().default(false),
  },
  (table) => [uniqueIndex("categories_slug_key").on(table.slug)],
);

/**
 * The canonical creator entity. A creator may hold several links; the creator,
 * not the link, is what people boost and what the leaderboard ranks.
 */
export const creators = pgTable(
  "creators",
  {
    id: primaryKeyColumn(),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio"),
    avatarUrl: text("avatar_url"),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    claimStatus: claimStatusEnum("claim_status").notNull().default("UNCLAIMED"),
    /** Every submission starts here. Only APPROVED is public. */
    moderationStatus: moderationStatusEnum("moderation_status").notNull().default("PENDING_REVIEW"),
    rejectionReason: rejectionReasonEnum("rejection_reason"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("creators_slug_key").on(table.slug),
    index("creators_moderation_status_idx").on(table.moderationStatus),
    index("creators_category_id_idx").on(table.categoryId),
  ],
);

export const creatorLinks = pgTable(
  "creator_links",
  {
    id: primaryKeyColumn(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    platform: creatorPlatformEnum("platform").notNull(),
    handle: text("handle").notNull(),
    url: text("url").notNull(),
    /**
     * The deduplication key derived from the normalized URL, for example
     * `instagram:handle` or `spotify:artist-id`. Uniqueness is enforced by the
     * database so two submissions can never race past an application check.
     */
    normalizedKey: text("normalized_key").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("creator_links_normalized_key_key").on(table.normalizedKey),
    index("creator_links_creator_id_idx").on(table.creatorId),
  ],
);

/**
 * Profiles that verified an opt-out and must not be resubmitted. Deliberately
 * holds no personal information beyond the normalized key.
 */
export const creatorSuppressions = pgTable(
  "creator_suppressions",
  {
    id: primaryKeyColumn(),
    normalizedKey: text("normalized_key").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [uniqueIndex("creator_suppressions_normalized_key_key").on(table.normalizedKey)],
);

export const reports = pgTable(
  "reports",
  {
    id: primaryKeyColumn(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    details: text("details"),
    status: reportStatusEnum("status").notNull().default("OPEN"),
    createdAt: createdAtColumn(),
    resolvedAt: timestampColumn("resolved_at"),
  },
  (table) => [index("reports_creator_id_idx").on(table.creatorId)],
);
