import {
  countCreatorsByModeration,
  type Database,
  findCategoryIdBySlug,
  findCreatorById,
  findCreatorByNormalizedKey,
  listCreatorsByModeration,
  suppressNormalizedKey,
  updateCreatorMetadata,
  updateCreatorModeration,
  withTransaction,
  writeAuditLog,
} from "@creator-outdoor/db";
import {
  assertModerationTransition,
  type ModerationStatus,
  normalizeCreatorUrl,
  type RejectionReason,
  requiresSuppression,
} from "@creator-outdoor/domain";

export type ModerationActor = string;

export class CreatorNotFoundError extends Error {
  override readonly name = "CreatorNotFoundError";
}

export type ModerationChange = {
  readonly creatorId: string;
  readonly to: ModerationStatus;
  readonly actor: ModerationActor;
  readonly action: string;
  readonly rejectionReason?: RejectionReason | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
};

/**
 * Applies a moderation decision.
 *
 * The transition is validated against the lifecycle, the change and its audit
 * entry commit together, and a verified opt-out also writes a suppression so the
 * profile cannot simply be resubmitted.
 */
export async function applyModerationChange(
  database: Database,
  change: ModerationChange,
): Promise<void> {
  const creator = await findCreatorById(database, change.creatorId);
  if (creator === null) {
    throw new CreatorNotFoundError(`No creator with id ${change.creatorId}`);
  }
  assertModerationTransition(creator.moderationStatus, change.to);

  await withTransaction(database, async (tx) => {
    await updateCreatorModeration(tx, {
      creatorId: change.creatorId,
      moderationStatus: change.to,
      rejectionReason: change.rejectionReason ?? null,
    });

    if (requiresSuppression(change.to)) {
      for (const link of creator.links) {
        const normalized = normalizeCreatorUrl(link.url);
        if (normalized.ok) {
          await suppressNormalizedKey(tx, normalized.normalizedKey, change.action);
        }
      }
    }

    await writeAuditLog(tx, {
      actor: change.actor,
      action: change.action,
      targetType: "creator",
      targetId: change.creatorId,
      metadata: {
        from: creator.moderationStatus,
        to: change.to,
        ...(change.rejectionReason === undefined
          ? {}
          : { rejectionReason: change.rejectionReason }),
        ...(change.metadata ?? {}),
      },
    });
  });
}

export type ApproveInput = {
  readonly creatorId: string;
  readonly actor: ModerationActor;
  readonly displayName?: string | undefined;
  readonly bio?: string | undefined;
  readonly avatarUrl?: string | undefined;
  readonly categorySlug?: string | undefined;
};

/**
 * Approves a creator, optionally completing the metadata that could not be
 * obtained safely at submission time.
 */
export async function approveCreator(database: Database, input: ApproveInput): Promise<void> {
  const categoryId =
    input.categorySlug === undefined
      ? undefined
      : ((await findCategoryIdBySlug(database, input.categorySlug)) ?? undefined);

  if (
    input.displayName !== undefined ||
    input.bio !== undefined ||
    input.avatarUrl !== undefined ||
    categoryId !== undefined
  ) {
    await updateCreatorMetadata(database, {
      creatorId: input.creatorId,
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      ...(input.bio === undefined ? {} : { bio: input.bio }),
      ...(input.avatarUrl === undefined ? {} : { avatarUrl: input.avatarUrl }),
      ...(categoryId === undefined ? {} : { categoryId }),
    });
  }

  await applyModerationChange(database, {
    creatorId: input.creatorId,
    to: "APPROVED",
    actor: input.actor,
    action: "creator.approved",
  });
}

export async function rejectCreator(
  database: Database,
  input: {
    readonly creatorId: string;
    readonly actor: ModerationActor;
    readonly reason: RejectionReason;
    readonly note?: string | undefined;
  },
): Promise<void> {
  await applyModerationChange(database, {
    creatorId: input.creatorId,
    to: "REJECTED",
    actor: input.actor,
    action: "creator.rejected",
    rejectionReason: input.reason,
    ...(input.note === undefined ? {} : { metadata: { note: input.note } }),
  });
}

export async function removeCreator(
  database: Database,
  input: {
    readonly creatorId: string;
    readonly actor: ModerationActor;
    readonly note?: string | undefined;
  },
): Promise<void> {
  await applyModerationChange(database, {
    creatorId: input.creatorId,
    to: "REMOVED",
    actor: input.actor,
    action: "creator.removed",
    ...(input.note === undefined ? {} : { metadata: { note: input.note } }),
  });
}

export async function restoreCreator(
  database: Database,
  input: { readonly creatorId: string; readonly actor: ModerationActor },
): Promise<void> {
  await applyModerationChange(database, {
    creatorId: input.creatorId,
    to: "APPROVED",
    actor: input.actor,
    action: "creator.restored",
  });
}

export async function getModerationQueue(
  database: Database,
  status: ModerationStatus,
  limit: number,
  offset: number,
) {
  const [creators, total] = await Promise.all([
    listCreatorsByModeration(database, status, limit, offset),
    countCreatorsByModeration(database, status),
  ]);
  return { creators, total };
}

export async function findDuplicateOf(database: Database, url: string) {
  const normalized = normalizeCreatorUrl(url);
  return normalized.ok ? findCreatorByNormalizedKey(database, normalized.normalizedKey) : null;
}
