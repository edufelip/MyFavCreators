import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { creatorLinks, creators } from "./catalog";
import { createdAtColumn, primaryKeyColumn, timestampColumn } from "./columns";
import { impressionSurfaceEnum } from "./enums";

/**
 * Delivery measurement for Creator Outdoor itself.
 *
 * Nothing in this file is ever read by a ranking query. Impressions, outbound
 * clicks and CTR measure what the platform delivered; they never buy position.
 */
export const impressions = pgTable(
  "impressions",
  {
    id: primaryKeyColumn(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    surface: impressionSurfaceEnum("surface").notNull(),
    /** First-party analytics session id. Never exposed publicly. */
    sessionId: text("session_id").notNull(),
    hourBucket: timestampColumn("hour_bucket").notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    /** At most one impression per session, creator, surface and hour. */
    uniqueIndex("impressions_dedup_key").on(
      table.creatorId,
      table.surface,
      table.sessionId,
      table.hourBucket,
    ),
    index("impressions_creator_hour_idx").on(table.creatorId, table.hourBucket),
  ],
);

export const outboundClicks = pgTable(
  "outbound_clicks",
  {
    id: primaryKeyColumn(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    creatorLinkId: uuid("creator_link_id")
      .notNull()
      .references(() => creatorLinks.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    hourBucket: timestampColumn("hour_bucket").notNull(),
    referrer: text("referrer"),
    createdAt: createdAtColumn(),
  },
  (table) => [
    /** At most one click per session, link and hour. */
    uniqueIndex("outbound_clicks_dedup_key").on(
      table.creatorLinkId,
      table.sessionId,
      table.hourBucket,
    ),
    index("outbound_clicks_creator_hour_idx").on(table.creatorId, table.hourBucket),
  ],
);
