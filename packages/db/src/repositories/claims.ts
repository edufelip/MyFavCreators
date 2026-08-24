import { and, eq, isNull } from "drizzle-orm";
import type { DatabaseExecutor } from "../client";
import { creatorClaims, creators } from "../schema";

/**
 * A verified creator's grip on their own profile.
 *
 * The management token is only ever seen as a hash. Nothing in this file
 * accepts or returns a raw token: callers hash first, so a token cannot reach a
 * query log or an error message by accident.
 */

export type CreatorClaimRow = {
  readonly id: string;
  readonly creatorId: string;
  readonly email: string | null;
};

export type ClaimedCreator = {
  readonly claimId: string;
  readonly creatorId: string;
  readonly slug: string;
  readonly displayName: string;
  /** The claimant's contact. Private; used for their own notifications. */
  readonly email: string | null;
};

/**
 * Records a verified claim, replacing any token the creator held before.
 *
 * Re-verifying is how somebody who lost their token gets back in, and it must
 * cut off the old one: a claim proven twice means the profile has one owner
 * with one live token, not two.
 */
export async function upsertCreatorClaim(
  executor: DatabaseExecutor,
  input: {
    readonly creatorId: string;
    readonly email: string | null;
    readonly tokenHash: string;
  },
): Promise<CreatorClaimRow> {
  const rows = await executor
    .insert(creatorClaims)
    .values({
      creatorId: input.creatorId,
      email: input.email,
      tokenHash: input.tokenHash,
    })
    .onConflictDoUpdate({
      target: creatorClaims.creatorId,
      set: { email: input.email, tokenHash: input.tokenHash, revokedAt: null },
    })
    .returning({
      id: creatorClaims.id,
      creatorId: creatorClaims.creatorId,
      email: creatorClaims.email,
    });
  const row = rows[0];
  if (row === undefined) {
    throw new Error("Failed to record a creator claim");
  }
  return row;
}

/**
 * Who a management token belongs to.
 *
 * Only a live claim on a publicly eligible creator resolves: a revoked token,
 * or one for a profile that has since been removed, authenticates nobody.
 */
export async function findCreatorByClaimToken(
  executor: DatabaseExecutor,
  tokenHash: string,
): Promise<ClaimedCreator | null> {
  const rows = await executor
    .select({
      claimId: creatorClaims.id,
      creatorId: creators.id,
      slug: creators.slug,
      displayName: creators.displayName,
      email: creatorClaims.email,
    })
    .from(creatorClaims)
    .innerJoin(creators, eq(creators.id, creatorClaims.creatorId))
    .where(
      and(
        eq(creatorClaims.tokenHash, tokenHash),
        isNull(creatorClaims.revokedAt),
        eq(creators.moderationStatus, "APPROVED"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Updates the contact a claimed creator uses for their own notifications. */
export async function setClaimEmail(
  executor: DatabaseExecutor,
  creatorId: string,
  email: string | null,
): Promise<void> {
  await executor.update(creatorClaims).set({ email }).where(eq(creatorClaims.creatorId, creatorId));
}

/** Ends a management session without erasing the record of who claimed what. */
export async function revokeCreatorClaim(
  executor: DatabaseExecutor,
  creatorId: string,
  at: Date,
): Promise<void> {
  await executor
    .update(creatorClaims)
    .set({ revokedAt: at })
    .where(eq(creatorClaims.creatorId, creatorId));
}

/** The fields a claimed creator may change about their own profile. */
export async function updateCreatorProfile(
  executor: DatabaseExecutor,
  input: {
    readonly creatorId: string;
    readonly bio: string | null;
    readonly categoryId?: string;
    readonly at: Date;
  },
): Promise<void> {
  await executor
    .update(creators)
    .set({
      bio: input.bio,
      updatedAt: input.at,
      ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
    })
    .where(eq(creators.id, input.creatorId));
}

/** Marks a profile as claimed. Nothing else about it changes. */
export async function setCreatorClaimStatus(
  executor: DatabaseExecutor,
  creatorId: string,
  claimStatus: "UNCLAIMED" | "PENDING" | "CLAIMED",
  at: Date,
): Promise<void> {
  await executor
    .update(creators)
    .set({ claimStatus, updatedAt: at })
    .where(eq(creators.id, creatorId));
}
