import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { creators } from "./catalog";
import { createdAtColumn, primaryKeyColumn, timestampColumn } from "./columns";
import { verificationPurposeEnum, verificationStatusEnum } from "./enums";

/**
 * A proof-of-ownership challenge issued against a creator profile.
 *
 * An unauthenticated visitor may request removal, but the request alone changes
 * nothing public: the code has to appear on the profile before the creator is
 * hidden. The same mechanism verifies a claim in a later phase, which is why the
 * row carries a purpose.
 */
export const creatorVerifications = pgTable(
  "creator_verifications",
  {
    id: primaryKeyColumn(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    purpose: verificationPurposeEnum("purpose").notNull(),
    /** The code the requester must place on the profile. Globally unique. */
    code: text("code").notNull(),
    status: verificationStatusEnum("status").notNull().default("PENDING"),
    /** Optional contact for the outcome. Never public. */
    contactEmail: text("contact_email"),
    createdAt: createdAtColumn(),
    expiresAt: timestampColumn("expires_at").notNull(),
    verifiedAt: timestampColumn("verified_at"),
  },
  (table) => [
    uniqueIndex("creator_verifications_code_key").on(table.code),
    /**
     * At most one open challenge per creator and purpose, so a flood of removal
     * requests cannot issue a thousand codes for the same profile.
     */
    uniqueIndex("creator_verifications_open_key")
      .on(table.creatorId, table.purpose)
      .where(sql`status = 'PENDING'`),
    index("creator_verifications_creator_idx").on(table.creatorId, table.purpose),
  ],
);
