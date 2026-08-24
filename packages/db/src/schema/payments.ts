import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, primaryKeyColumn, timestampColumn, updatedAtColumn } from "./columns";
import { paymentStatusEnum } from "./enums";

export const payments = pgTable(
  "payments",
  {
    id: primaryKeyColumn(),
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id").notNull(),
    /** Integer centavos. BRL is never stored as a float. */
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("BRL"),
    status: paymentStatusEnum("status").notNull().default("CREATED"),
    rawMetadata: jsonb("raw_metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    confirmedAt: timestampColumn("confirmed_at"),
    refundedAt: timestampColumn("refunded_at"),
  },
  (table) => [
    /**
     * Payment idempotency. Two webhook deliveries for the same provider payment
     * can never create two payment rows, regardless of application logic.
     */
    uniqueIndex("payments_provider_payment_key").on(table.provider, table.providerPaymentId),
    index("payments_status_confirmed_at_idx").on(table.status, table.confirmedAt),
  ],
);

/**
 * The append-only record of provider events applied to a payment.
 *
 * `event_fingerprint` is unique, so a replayed webhook collides at the database
 * level: a duplicate can never activate a boost twice, increment a score twice
 * or send a notification twice.
 */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: primaryKeyColumn(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    providerEventId: text("provider_event_id"),
    eventFingerprint: text("event_fingerprint").notNull(),
    fromStatus: paymentStatusEnum("from_status"),
    toStatus: paymentStatusEnum("to_status").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex("payment_events_fingerprint_key").on(table.eventFingerprint),
    index("payment_events_payment_id_idx").on(table.paymentId),
  ],
);
