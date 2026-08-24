import { type DatabaseExecutor, schema } from "@creator-outdoor/db";
import type { ImpressionSurface } from "@creator-outdoor/db/schema";
import type { ModerationStatus } from "@creator-outdoor/domain";
import { eq } from "drizzle-orm";

/**
 * State changes tests need to express.
 *
 * They live here rather than in the test files so application tests never
 * import database infrastructure directly.
 */
export async function setCreatorModerationStatus(
  executor: DatabaseExecutor,
  creatorId: string,
  moderationStatus: ModerationStatus,
): Promise<void> {
  await executor
    .update(schema.creators)
    .set({ moderationStatus })
    .where(eq(schema.creators.id, creatorId));
}

/** Applies the effect a refund has on ranking inputs: REVERSED boost, REFUNDED payment. */
export async function refundBoost(
  executor: DatabaseExecutor,
  ids: { readonly boostId: string; readonly paymentId: string },
  refundedAt: Date = new Date(),
): Promise<void> {
  await executor
    .update(schema.boosts)
    .set({ status: "REVERSED", updatedAt: refundedAt })
    .where(eq(schema.boosts.id, ids.boostId));
  await executor
    .update(schema.payments)
    .set({ status: "REFUNDED", refundedAt, updatedAt: refundedAt })
    .where(eq(schema.payments.id, ids.paymentId));
}

export async function findPrimaryLinkId(
  executor: DatabaseExecutor,
  creatorId: string,
): Promise<string> {
  const rows = await executor
    .select({ id: schema.creatorLinks.id })
    .from(schema.creatorLinks)
    .where(eq(schema.creatorLinks.creatorId, creatorId))
    .limit(1);
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error(`Creator ${creatorId} has no link`);
  }
  return id;
}

export async function insertImpression(
  executor: DatabaseExecutor,
  input: {
    readonly creatorId: string;
    readonly sessionId: string;
    readonly surface?: ImpressionSurface;
    readonly hourBucket?: Date;
  },
): Promise<void> {
  await executor.insert(schema.impressions).values({
    creatorId: input.creatorId,
    surface: input.surface ?? "LEADERBOARD",
    sessionId: input.sessionId,
    hourBucket: input.hourBucket ?? new Date("2026-08-19T18:00:00.000Z"),
  });
}

export async function insertOutboundClick(
  executor: DatabaseExecutor,
  input: {
    readonly creatorId: string;
    readonly creatorLinkId: string;
    readonly sessionId: string;
    readonly hourBucket?: Date;
  },
): Promise<void> {
  await executor.insert(schema.outboundClicks).values({
    creatorId: input.creatorId,
    creatorLinkId: input.creatorLinkId,
    sessionId: input.sessionId,
    hourBucket: input.hourBucket ?? new Date("2026-08-19T18:00:00.000Z"),
  });
}

/** Suppresses a normalized key, as a verified opt-out does. */
export async function suppressKey(
  executor: DatabaseExecutor,
  normalizedKey: string,
  reason: string,
): Promise<void> {
  await executor
    .insert(schema.creatorSuppressions)
    .values({ normalizedKey, reason })
    .onConflictDoNothing({ target: schema.creatorSuppressions.normalizedKey });
}
