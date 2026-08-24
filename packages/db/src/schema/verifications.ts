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

/**
 * A verified creator's grip on their own profile.
 *
 * One row per creator, created when a claim is verified. The management token
 * is stored as a SHA-256 hash and never in the clear: a leaked database dump
 * must not hand somebody control of every claimed profile, and the raw token is
 * shown exactly once, at the moment of verification.
 *
 * `revoked_at` ends a session without deleting the claim, so an administrator
 * can cut off a compromised token while leaving the record of who claimed what.
 */
export const creatorClaims = pgTable(
  "creator_claims",
  {
    id: primaryKeyColumn(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    /** Contact for the claimant. Private, exactly like a supporter's. */
    email: text("email"),
    /** SHA-256 of the management token. The token itself is never stored. */
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAtColumn(),
    revokedAt: timestampColumn("revoked_at"),
  },
  (table) => [
    /** One claim per creator: a profile has one owner, not a queue of them. */
    uniqueIndex("creator_claims_creator_key").on(table.creatorId),
    uniqueIndex("creator_claims_token_key").on(table.tokenHash),
  ],
);
