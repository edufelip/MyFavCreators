import { apiConfig } from "@creator-outdoor/config/api";
import { closeDatabase } from "@creator-outdoor/db";
import { database } from "../database";
import { resolveEmailProvider } from "../email/resolve";
import { resolvePaymentProvider } from "../payments/resolve";
import { reconcilePayments } from "../services/reconciliation";

/**
 * Recovers payments whose webhook never arrived.
 *
 * Safe to run repeatedly: it routes every answer through the same transition
 * service the webhook uses, and the event fingerprint makes a repeat a no-op.
 *
 *   bun run job:payment-reconcile
 */
const provider = resolvePaymentProvider(apiConfig);
const summary = await reconcilePayments(database, apiConfig.product, provider, {
  now: new Date(),
  email: resolveEmailProvider(apiConfig),
  webOrigin: apiConfig.webOrigin,
});

console.info(
  `Reconciliation (${provider.name}): examined ${summary.examined}, ` +
    `changed ${summary.changed}, unchanged ${summary.unchanged}, failed ${summary.failed}.`,
);
await closeDatabase(database);
