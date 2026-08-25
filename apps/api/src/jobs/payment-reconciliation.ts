import { apiConfig } from "@creator-outdoor/config/api";
import { closeDatabase } from "@creator-outdoor/db";
import { database } from "../database";
import { resolveEmailProvider } from "../email/resolve";
import { resolveErrorTracker } from "../observability/resolve";
import { resolvePaymentProvider } from "../payments/resolve";
import { reconcilePayments } from "../services/reconciliation";
import { runJob } from "./run";

/**
 * Recovers payments whose webhook never arrived, and makes refunds the platform
 * owes but has not managed to send.
 *
 * Safe to run repeatedly: it routes every answer through the same transition
 * service the webhook uses, and the event fingerprint makes a repeat a no-op.
 *
 *   bun run job:payment-reconcile
 */
const provider = resolvePaymentProvider(apiConfig);

await runJob(
  "payment-reconcile",
  async () => {
    const summary = await reconcilePayments(database, apiConfig.product, provider, {
      now: new Date(),
      email: resolveEmailProvider(apiConfig),
      webOrigin: apiConfig.webOrigin,
    });
    return (
      `${provider.name}: examined ${summary.examined}, changed ${summary.changed}, ` +
      `unchanged ${summary.unchanged}, refunded ${summary.refunded}, failed ${summary.failed}`
    );
  },
  {
    tracker: resolveErrorTracker(apiConfig),
    close: () => closeDatabase(database),
    exit: (code) => process.exit(code),
  },
);
