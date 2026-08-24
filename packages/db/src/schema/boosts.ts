import { boolean, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { creators } from "./catalog";
import { createdAtColumn, primaryKeyColumn, timestampColumn, updatedAtColumn } from "./columns";
import { boostStatusEnum } from "./enums";
import { payments } from "./payments";

/**
 * A purchase of visibility on Creator Outdoor.
 *
 * No value is transferred to the promoted creator: there is no creator balance,
 * payout, split or escrow anywhere in this schema, by design.
 */
export const boosts = pgTable(
  "boosts",
  {
    id: primaryKeyColumn(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "restrict" }),
    /** Integer centavos. The exact amount paid becomes the exact amount applied. */
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("BRL"),
    supporterName: text("supporter_name"),
    supporterMessage: text("supporter_message"),
    anonymous: boolean("anonymous").notNull().default(false),
    /** Private. Never serialized into a public response. */
    supporterEmail: text("supporter_email"),
    /** Private HMAC-derived grouping key. Never serialized into a public response. */
    fanIdentityKey: text("fan_identity_key"),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    status: boostStatusEnum("status").notNull().default("PENDING"),
    confirmedAt: timestampColumn("confirmed_at"),
    rotationStartsAt: timestampColumn("rotation_starts_at"),
    rotationEndsAt: timestampColumn("rotation_ends_at"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    /** One payment funds exactly one boost. Activation cannot be duplicated. */
    uniqueIndex("boosts_payment_id_key").on(table.paymentId),
    index("boosts_creator_id_status_idx").on(table.creatorId, table.status),
    index("boosts_status_rotation_ends_at_idx").on(table.status, table.rotationEndsAt),
    index("boosts_fan_identity_key_idx").on(table.fanIdentityKey),
  ],
);
