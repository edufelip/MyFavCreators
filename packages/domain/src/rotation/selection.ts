import { createHash } from "node:crypto";

export type RotationCandidate = {
  readonly creatorId: string;
  /** The latest rotation expiry among the creator's active boosts. */
  readonly rotationEndsAt: Date;
};

export type RotationSelectionInput = {
  readonly candidates: readonly RotationCandidate[];
  readonly now: Date;
  readonly bucketMinutes: number;
  readonly maxVisible: number;
};

/**
 * The time bucket a rotation selection belongs to.
 *
 * Selection is stable inside a bucket and changes when the bucket does, which is
 * what makes the feed feel alive without being random on every request — and
 * what makes it cacheable and reproducible in a test.
 */
export function rotationBucket(now: Date, bucketMinutes: number): number {
  if (!Number.isInteger(bucketMinutes) || bucketMinutes <= 0) {
    throw new RangeError(`bucketMinutes must be a positive integer, received: ${bucketMinutes}`);
  }
  return Math.floor(now.getTime() / (bucketMinutes * 60 * 1000));
}

/** Deterministic, uniformly distributed ordering key for a creator in a bucket. */
function rotationHash(bucket: number, creatorId: string): string {
  return createHash("sha256").update(`${bucket}:${creatorId}`).digest("hex");
}

/**
 * Chooses which eligible creators appear in *Impulsionados agora* right now.
 *
 * A boost buys participation in the rotation pool for the configured period, so
 * the selection must be fair across everyone still entitled — not simply the
 * most recently boosted. Showing the newest 30 would make the 24-hour
 * entitlement misleading the moment a 31st creator is boosted.
 *
 * The order is a deterministic hash of the bucket and the creator id. It does
 * not depend on the amount paid, on impressions, on clicks, or on recency:
 * a creator who paid R$5 yesterday and one who paid R$500 a minute ago have the
 * same chance of appearing in any given bucket, which is exactly what the
 * entitlement promises.
 */
export function selectRotation(input: RotationSelectionInput): RotationCandidate[] {
  const bucket = rotationBucket(input.now, input.bucketMinutes);
  const eligible = input.candidates.filter(
    (candidate) => candidate.rotationEndsAt.getTime() > input.now.getTime(),
  );

  return eligible
    .map((candidate) => ({ candidate, key: rotationHash(bucket, candidate.creatorId) }))
    .sort((left, right) =>
      left.key === right.key
        ? left.candidate.creatorId.localeCompare(right.candidate.creatorId)
        : left.key.localeCompare(right.key),
    )
    .slice(0, Math.max(0, input.maxVisible))
    .map((entry) => entry.candidate);
}
