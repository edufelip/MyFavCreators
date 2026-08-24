import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { creators } from "./catalog";
import { createdAtColumn, primaryKeyColumn, timestampColumn } from "./columns";
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

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: primaryKeyColumn(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAtColumn(),
  },
  (table) => [index("audit_logs_target_idx").on(table.targetType, table.targetId)],
);
