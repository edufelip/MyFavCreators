import type { ProductConfig } from "@creator-outdoor/config";
import {
  claimNotificationDelivery,
  type Database,
  findCreatorById,
  listActiveSubscribers,
  releaseNotificationDelivery,
  type SubscriptionRow,
  upsertNotificationSubscription,
} from "@creator-outdoor/db";
import {
  createUnsubscribeToken,
  isEmail,
  type NotificationType,
  normalizeEmail,
  redactEmail,
} from "@creator-outdoor/domain";
import type { EmailProvider } from "../email/provider";
import { log } from "../observability/logger";
import { dethroneEmail } from "./notification-templates";
import type { LeaderChange } from "./rank-events";

export type NotificationDependencies = {
  readonly database: Database;
  readonly product: ProductConfig;
  readonly email: EmailProvider;
  /** Where an unsubscribe link points. The public site, never the API. */
  readonly webOrigin: string;
};

/**
 * Records that somebody agreed to be written to about a creator.
 *
 * Called when a boost confirms, with the answers the payer actually gave. An
 * address alone is not agreement — it is what a receipt goes to — so nothing is
 * recorded for a notification nobody asked for, and an absent answer is a no.
 *
 * One subscription per type, each with its own unsubscribe token, so stopping
 * one leaves the other running.
 *
 * A bad address is not an error worth failing a payment over — the boost is
 * already paid and activated — so it is dropped quietly.
 */
export async function subscribeToNotifications(
  database: Database,
  input: {
    readonly email: string | null;
    readonly creatorId: string;
    readonly types: readonly NotificationType[];
  },
): Promise<readonly SubscriptionRow[]> {
  if (input.email === null || input.types.length === 0) {
    return [];
  }
  if (!isEmail(input.email)) {
    /*
     * Somebody ticked the box and will never hear anything. The address is not
     * logged — that is the one rule this file exists under — but the fact that a
     * consent was accepted and could not be honoured is worth a line, because
     * from the payer's side it looks exactly like a notification that failed to
     * send.
     */
    log.warn("notification_consent_unusable_address", { creatorId: input.creatorId });
    return [];
  }
  const email = normalizeEmail(input.email);

  const rows: SubscriptionRow[] = [];
  for (const type of input.types) {
    rows.push(
      await upsertNotificationSubscription(database, {
        email,
        creatorId: input.creatorId,
        type,
        unsubToken: createUnsubscribeToken(),
      }),
    );
  }
  return rows;
}

/** The notifications a set of answers agreed to. Absent answers agree to nothing. */
export function consentedNotificationTypes(input: {
  readonly notifyOnDethrone: boolean;
  readonly notifyWeeklyRecap: boolean;
}): readonly NotificationType[] {
  const types: NotificationType[] = [];
  if (input.notifyOnDethrone) {
    types.push("DETHRONE");
  }
  if (input.notifyWeeklyRecap) {
    types.push("WEEKLY_RECAP");
  }
  return types;
}

/**
 * Tells a creator's followers that somebody took first place from them.
 *
 * Only a genuine change of leader qualifies, which `detectLeaderChange` decides:
 * a climb that stops short of the top is real movement, shown on the ticker,
 * and not worth an email. Training people to ignore this mail would cost the one
 * notification that matters.
 *
 * Each delivery is claimed against a unique key before it is sent, so a retried
 * job, a redelivered webhook and two racing processes all produce exactly one
 * email. The claim is released only when the send itself failed, so a later run
 * can try again — a crash between claim and send costs one email nobody
 * receives, which is the cheaper of the two mistakes.
 */
export async function notifyDethrone(
  dependencies: NotificationDependencies,
  change: LeaderChange,
  dedupeKey: string,
): Promise<number> {
  const [dethroned, challenger] = await Promise.all([
    findCreatorById(dependencies.database, change.previousLeaderId),
    findCreatorById(dependencies.database, change.newLeaderId),
  ]);
  if (dethroned === null || challenger === null) {
    return 0;
  }

  const subscribers = await listActiveSubscribers(dependencies.database, dethroned.id, "DETHRONE");

  let sent = 0;
  for (const subscriber of subscribers) {
    const claimed = await claimNotificationDelivery(dependencies.database, {
      subscriptionId: subscriber.id,
      type: "DETHRONE",
      dedupeKey,
      metadata: { creatorSlug: dethroned.slug, newLeaderSlug: challenger.slug },
    });
    if (!claimed) {
      continue;
    }

    const message = dethroneEmail({
      dethronedName: dethroned.displayName,
      dethronedSlug: dethroned.slug,
      challengerName: challenger.displayName,
      webOrigin: dependencies.webOrigin,
      unsubToken: subscriber.unsubToken,
      to: subscriber.email,
    });

    try {
      await dependencies.email.send(message);
      sent += 1;
    } catch (error) {
      await releaseNotificationDelivery(dependencies.database, {
        subscriptionId: subscriber.id,
        dedupeKey,
      });
      log.error("dethrone_email_failed", error, { to: redactEmail(subscriber.email) });
    }
  }
  return sent;
}
