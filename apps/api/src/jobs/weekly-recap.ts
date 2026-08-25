import { apiConfig } from "@creator-outdoor/config/api";
import { closeDatabase } from "@creator-outdoor/db";
import { database } from "../database";
import { resolveEmailProvider } from "../email/resolve";
import { resolveErrorTracker } from "../observability/resolve";
import { sendWeeklyRecaps } from "../services/weekly-recap";
import { runJob } from "./run";

/**
 * Emails each subscriber how the week went for the creator they follow.
 *
 * Run after the weekly rollover. Safe to run twice: each delivery is claimed
 * against a key naming the period, so nobody receives a second copy.
 *
 *   bun run job:weekly-recap
 */
await runJob(
  "weekly-recap",
  async () => {
    const summary = await sendWeeklyRecaps(
      database,
      apiConfig.product,
      resolveEmailProvider(apiConfig),
      { now: new Date(), webOrigin: apiConfig.webOrigin },
    );
    return (
      `considered ${summary.considered}, sent ${summary.sent}, ` +
      `skipped ${summary.skipped}, failed ${summary.failed}`
    );
  },
  {
    tracker: resolveErrorTracker(apiConfig),
    close: () => closeDatabase(database),
    exit: (code) => process.exit(code),
  },
);
