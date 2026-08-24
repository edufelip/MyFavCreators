import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { creators } from "./catalog";
import { createdAtColumn, jsonbObject, primaryKeyColumn, timestampColumn } from "./columns";
import { notificationTypeEnum } from "./enums";

export const notificationSubscriptions = pgTable(
  "notification_subscriptions",
  {
    id: primaryKeyColumn(),
    email: text("email").notNull(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    /** Powers one-click unsubscribe in every notification email. */
    unsubToken: text("unsub_token").notNull(),
    createdAt: createdAtColumn(),
    disabledAt: timestampColumn("disabled_at"),
  },
  (table) => [
    uniqueIndex("notification_subscriptions_unsub_token_key").on(table.unsubToken),
    uniqueIndex("notification_subscriptions_email_creator_type_key").on(
      table.email,
      table.creatorId,
      table.type,
    ),
  ],
);

/**
 * One row per notification actually sent.
 *
 * `dedupe_key` is unique, so an email can never be sent twice for the same
 * happening: a retried job, a webhook redelivered, or two processes racing all
 * collide at the database rather than in whichever piece of application logic
 * happens to run. Nobody gets the same "voce foi ultrapassado" twice.
 */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: primaryKeyColumn(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => notificationSubscriptions.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    /** Identifies the happening, not the message. */
    dedupeKey: text("dedupe_key").notNull(),
    metadata: jsonbObject("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("notification_deliveries_dedupe_key").on(table.subscriptionId, table.dedupeKey),
    index("notification_deliveries_subscription_idx").on(table.subscriptionId, table.createdAt),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: primaryKeyColumn(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: jsonbObject("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAtColumn(),
  },
  (table) => [index("audit_logs_target_idx").on(table.targetType, table.targetId)],
);
