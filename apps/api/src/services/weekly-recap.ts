import type { ProductConfig } from "@creator-outdoor/config";
import {
  claimNotificationDelivery,
  type Database,
  getCreatorStanding,
  listActiveSubscriptions,
  releaseNotificationDelivery,
} from "@creator-outdoor/db";
import { centsValue, getWeeklyPeriod, redactEmail } from "@creator-outdoor/domain";
import type { EmailProvider } from "../email/provider";
import { log } from "../observability/logger";
import { weeklyRecapEmail } from "./notification-templates";

export type WeeklyRecapSummary = {
  readonly considered: number;
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
};

export type WeeklyRecapOptions = {
  readonly now: Date;
  readonly webOrigin: string;
  readonly limit?: number;
};

/**
 * Sends each subscriber how the week went for the creator they follow.
 *
 * The recap describes the week that just ended, so it runs after the rollover
 * and reads the closed period rather than the live one — a recap computed from
 * "now" on a Monday morning would report an empty week that had just started.
 *
 * Idempotent by the same mechanism as every other notification: the delivery is
 * claimed against a key naming the period, so running the job twice, or running
 * it again after a partial failure, sends nobody a second copy.
 */
export async function sendWeeklyRecaps(
  database: Database,
  product: ProductConfig,
  email: EmailProvider,
  options: WeeklyRecapOptions,
): Promise<WeeklyRecapSummary> {
  const period = getWeeklyPeriod(options.now, product.timezone, -1);
  const window = { startsAt: period.startsAt, endsAt: period.endsAt };
  const dedupeKey = `recap:${period.startsAt.toISOString()}`;

  const subscriptions = await listActiveSubscriptions(database, "DETHRONE", options.limit ?? 1_000);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    const claimed = await claimNotificationDelivery(database, {
      subscriptionId: subscription.id,
      type: "DETHRONE",
      dedupeKey,
      metadata: { periodStartsAt: period.startsAt.toISOString() },
    });
    if (!claimed) {
      skipped += 1;
      continue;
    }

    const standing = await getCreatorStanding(database, subscription.creatorId, window);
    const message = weeklyRecapEmail({
      to: subscription.email,
      creatorName: subscription.creatorDisplayName,
      creatorSlug: subscription.creatorSlug,
      rank: standing.rank,
      amountLabel: formatAmount(centsValue(standing.amountCents)),
      supporterCount: standing.supporterCount,
      webOrigin: options.webOrigin,
      unsubToken: subscription.unsubToken,
    });

    try {
      await email.send(message);
      sent += 1;
    } catch (error) {
      await releaseNotificationDelivery(database, {
        subscriptionId: subscription.id,
        dedupeKey,
      });
      failed += 1;
      log.error("weekly_recap_failed", error, { to: redactEmail(subscription.email) });
    }
  }

  return { considered: subscriptions.length, sent, skipped, failed };
}

/**
 * Money in an email.
 *
 * The web app formats money for the browser; this is the same rule for a
 * plain-text message, and it stays integer centavos until the last step.
 */
function formatAmount(cents: number): string {
  const reais = Math.trunc(cents / 100);
  const centavos = cents % 100;
  const whole = reais.toLocaleString("pt-BR");
  return centavos === 0 ? `R$${whole}` : `R$${whole},${String(centavos).padStart(2, "0")}`;
}
