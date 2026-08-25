import { apiConfig } from "@creator-outdoor/config/api";
import { closeDatabase } from "@creator-outdoor/db";
import { database } from "../database";
import { resolveErrorTracker } from "../observability/resolve";
import { runWeeklyRollover } from "../services/rollover";
import { runJob } from "./run";

/**
 * Closes finished weekly periods and snapshots their final rankings.
 *
 * Safe to run repeatedly, late, or twice at once. Scheduled in production; the
 * live ranking never depends on it having run.
 *
 *   bun run job:weekly-rollover
 */
await runJob(
  "weekly-rollover",
  async () => {
    const summary = await runWeeklyRollover(database, apiConfig.product, new Date());
    return (
      `closed ${summary.closedPeriods} period(s), ` +
      `snapshotted ${summary.snapshotted} creator ranking(s)` +
      (summary.champion === null ? "" : `, champion @${summary.champion}`)
    );
  },
  {
    tracker: resolveErrorTracker(apiConfig),
    close: () => closeDatabase(database),
    exit: (code) => process.exit(code),
  },
);
