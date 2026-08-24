import { index, integer, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { creators } from "./catalog";
import { createdAtColumn, primaryKeyColumn, timestampColumn, updatedAtColumn } from "./columns";
import { rankingPeriodStatusEnum, rankingPeriodTypeEnum } from "./enums";

/**
 * A closed-over ranking window.
 *
 * The *current* week is never read from this table: it is computed from the
 * instant, so a late or repeated rollover cannot move a boost into the wrong
 * period. Rows exist so a closed period can be snapshotted and preserved.
 */
export const rankingPeriods = pgTable(
  "ranking_periods",
  {
    id: primaryKeyColumn(),
    type: rankingPeriodTypeEnum("type").notNull(),
    startsAt: timestampColumn("starts_at").notNull(),
    endsAt: timestampColumn("ends_at").notNull(),
    status: rankingPeriodStatusEnum("status").notNull().default("OPEN"),
    createdAt: createdAtColumn(),
    closedAt: timestampColumn("closed_at"),
  },
  (table) => [
    uniqueIndex("ranking_periods_type_window_key").on(table.type, table.startsAt, table.endsAt),
  ],
);

/**
 * The final ranking of a closed period.
 *
 * A refund arriving after the period closed recomputes these rows, so the Hall
 * da Fama always reflects financially active boosts rather than stale history.
 */
export const creatorRankingSnapshots = pgTable(
  "creator_ranking_snapshots",
  {
    id: primaryKeyColumn(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    rankingPeriodId: uuid("ranking_period_id")
      .notNull()
      .references(() => rankingPeriods.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    supporterCount: integer("supporter_count").notNull().default(0),
    rank: integer("rank").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    /** Makes weekly rollover idempotent: a snapshot cannot be duplicated. */
    uniqueIndex("creator_ranking_snapshots_period_creator_key").on(
      table.creatorId,
      table.rankingPeriodId,
    ),
    index("creator_ranking_snapshots_period_rank_idx").on(table.rankingPeriodId, table.rank),
  ],
);

/** Secondary data behind the overtake ticker. Never an input to a ranking. */
export const rankEvents = pgTable(
  "rank_events",
  {
    id: primaryKeyColumn(),
    rankingPeriodId: uuid("ranking_period_id")
      .notNull()
      .references(() => rankingPeriods.id, { onDelete: "cascade" }),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    passedCreatorId: uuid("passed_creator_id").references(() => creators.id, {
      onDelete: "set null",
    }),
    fromRank: integer("from_rank").notNull(),
    toRank: integer("to_rank").notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index("rank_events_period_created_at_idx").on(table.rankingPeriodId, table.createdAt),
  ],
);
