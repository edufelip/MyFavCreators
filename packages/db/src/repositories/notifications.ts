import type { NotificationType } from "@creator-outdoor/domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../client";
import { creators, notificationDeliveries, notificationSubscriptions } from "../schema";

/**
 * Who asked to hear about a creator, and what has already been sent to them.
 *
 * Email addresses live here and are never published: no public response
 * serializes one, and no log line prints one in full.
 */

export type SubscriptionRow = {
  readonly id: string;
  readonly email: string;
  readonly creatorId: string;
  readonly unsubToken: string;
};

/**
 * Records an interest, or revives one that was switched off.
 *
 * Unique on (email, creator, type), so the same person boosting the same
 * creator five times is one subscription and therefore one email per happening.
 *
 * A previously unsubscribed row is re-enabled rather than duplicated: somebody
 * who opts back in should not end up with two rows, one of them permanently
 * dead. **This only ever runs on fresh, explicit consent** — the caller reaches
 * here because somebody ticked a box on a purchase they just made. Calling it
 * on the mere presence of an address would quietly undo an unsubscribe, which
 * is the one thing every message this system sends promises it will not do.
 */
export async function upsertNotificationSubscription(
  executor: DatabaseExecutor,
  input: {
    readonly email: string;
    readonly creatorId: string;
    readonly type: NotificationType;
    readonly unsubToken: string;
  },
): Promise<SubscriptionRow> {
  const rows = await executor
    .insert(notificationSubscriptions)
    .values({
      email: input.email,
      creatorId: input.creatorId,
      type: input.type,
      unsubToken: input.unsubToken,
    })
    .onConflictDoUpdate({
      target: [
        notificationSubscriptions.email,
        notificationSubscriptions.creatorId,
        notificationSubscriptions.type,
      ],
      set: { disabledAt: null },
    })
    .returning({
      id: notificationSubscriptions.id,
      email: notificationSubscriptions.email,
      creatorId: notificationSubscriptions.creatorId,
      unsubToken: notificationSubscriptions.unsubToken,
    });
  const row = rows[0];
  if (row === undefined) {
    throw new Error("Failed to record a notification subscription");
  }
  return row;
}

/** Whether one person is still listening for one creator. */
export async function hasActiveSubscription(
  executor: DatabaseExecutor,
  input: {
    readonly email: string;
    readonly creatorId: string;
    readonly type: NotificationType;
  },
): Promise<boolean> {
  const rows = await executor
    .select({ id: notificationSubscriptions.id })
    .from(notificationSubscriptions)
    .where(
      and(
        eq(notificationSubscriptions.email, input.email),
        eq(notificationSubscriptions.creatorId, input.creatorId),
        eq(notificationSubscriptions.type, input.type),
        isNull(notificationSubscriptions.disabledAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Switches one person's subscription off, by address rather than by token. */
export async function disableSubscription(
  executor: DatabaseExecutor,
  input: {
    readonly email: string;
    readonly creatorId: string;
    readonly type: NotificationType;
    readonly at: Date;
  },
): Promise<void> {
  await executor
    .update(notificationSubscriptions)
    .set({ disabledAt: input.at })
    .where(
      and(
        eq(notificationSubscriptions.email, input.email),
        eq(notificationSubscriptions.creatorId, input.creatorId),
        eq(notificationSubscriptions.type, input.type),
      ),
    );
}

/** Everyone still listening for one creator. Unsubscribed rows never appear. */
export async function listActiveSubscribers(
  executor: DatabaseExecutor,
  creatorId: string,
  type: NotificationType,
): Promise<readonly SubscriptionRow[]> {
  return executor
    .select({
      id: notificationSubscriptions.id,
      email: notificationSubscriptions.email,
      creatorId: notificationSubscriptions.creatorId,
      unsubToken: notificationSubscriptions.unsubToken,
    })
    .from(notificationSubscriptions)
    .innerJoin(creators, eq(creators.id, notificationSubscriptions.creatorId))
    .where(
      and(
        eq(notificationSubscriptions.creatorId, creatorId),
        eq(notificationSubscriptions.type, type),
        isNull(notificationSubscriptions.disabledAt),
        // A creator who stopped being public stops generating mail about
        // themselves; nobody should hear from a profile that is gone.
        eq(creators.moderationStatus, "APPROVED"),
      ),
    );
}

/**
 * Claims the right to send one notification.
 *
 * Returns false when this exact happening was already delivered to this
 * subscriber. The unique index is what enforces it, so two processes racing
 * cannot both win, and a retried job sends nothing a second time.
 *
 * Claimed before sending, never after: a crash between the two costs one email
 * nobody receives, while the other order costs a duplicate for every retry.
 */
export async function claimNotificationDelivery(
  executor: DatabaseExecutor,
  input: {
    readonly subscriptionId: string;
    readonly type: NotificationType;
    readonly dedupeKey: string;
    readonly metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  const inserted = await executor
    .insert(notificationDeliveries)
    .values({
      subscriptionId: input.subscriptionId,
      type: input.type,
      dedupeKey: input.dedupeKey,
      metadata: input.metadata ?? {},
    })
    .onConflictDoNothing()
    .returning({ id: notificationDeliveries.id });
  return inserted.length > 0;
}

/** Releases a claim whose send failed, so a later run may try again. */
export async function releaseNotificationDelivery(
  executor: DatabaseExecutor,
  input: { readonly subscriptionId: string; readonly dedupeKey: string },
): Promise<void> {
  await executor
    .delete(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.subscriptionId, input.subscriptionId),
        eq(notificationDeliveries.dedupeKey, input.dedupeKey),
      ),
    );
}

/**
 * Switches a subscription off by its token.
 *
 * Returns true when something was switched off and false when the token is
 * unknown *or already used*, which is why the caller must answer the same way
 * to both: a differing answer would turn the unsubscribe link into an oracle
 * for whether an address is subscribed.
 */
export async function disableSubscriptionByToken(
  executor: DatabaseExecutor,
  token: string,
  at: Date,
): Promise<NotificationType | null> {
  const updated = await executor
    .update(notificationSubscriptions)
    .set({ disabledAt: at })
    .where(
      and(
        eq(notificationSubscriptions.unsubToken, token),
        isNull(notificationSubscriptions.disabledAt),
      ),
    )
    // Which kind was switched off, not merely that one was. The log line is the
    // only record that somebody withdrew consent, and there are two kinds to
    // withdraw; a line that always named the same one was recording a fiction.
    .returning({ type: notificationSubscriptions.type });
  return updated[0]?.type ?? null;
}

/** Every active subscriber, grouped for the weekly recap. */
export async function listActiveSubscriptions(
  executor: DatabaseExecutor,
  type: NotificationType,
  limit: number,
): Promise<
  ReadonlyArray<
    SubscriptionRow & { readonly creatorSlug: string; readonly creatorDisplayName: string }
  >
> {
  return executor
    .select({
      id: notificationSubscriptions.id,
      email: notificationSubscriptions.email,
      creatorId: notificationSubscriptions.creatorId,
      unsubToken: notificationSubscriptions.unsubToken,
      creatorSlug: creators.slug,
      creatorDisplayName: creators.displayName,
    })
    .from(notificationSubscriptions)
    .innerJoin(creators, eq(creators.id, notificationSubscriptions.creatorId))
    .where(
      and(
        eq(notificationSubscriptions.type, type),
        isNull(notificationSubscriptions.disabledAt),
        eq(creators.moderationStatus, "APPROVED"),
      ),
    )
    .orderBy(sql`${notificationSubscriptions.email} asc`)
    .limit(limit);
}
