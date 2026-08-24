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
  normalizeEmail,
  redactEmail,
} from "@creator-outdoor/domain";
import type { EmailProvider } from "../email/provider";
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
 * Records that somebody wants to hear when a creator loses the top spot.
 *
 * Called when a boost confirms and the payer left an address. The address is
 * theirs to give: it is stored privately, never published on the Torcida, and
 * every message it receives carries a one-click unsubscribe.
 *
 * A bad address is not an error worth failing a payment over — the boost is
 * already paid and activated — so it is dropped quietly.
 */
export async function subscribeToDethrone(
  database: Database,
  input: { readonly email: string | null; readonly creatorId: string },
): Promise<SubscriptionRow | null> {
  if (input.email === null || !isEmail(input.email)) {
    return null;
  }
  return upsertNotificationSubscription(database, {
    email: normalizeEmail(input.email),
    creatorId: input.creatorId,
    type: "DETHRONE",
    unsubToken: createUnsubscribeToken(),
  });
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
      console.error("dethrone_email_failed", {
        to: redactEmail(subscriber.email),
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return sent;
}
