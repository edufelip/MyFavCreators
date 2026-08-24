import { apiConfig } from "@creator-outdoor/config/api";
import { closeDatabase } from "@creator-outdoor/db";
import { database } from "../database";
import { log } from "../observability/logger";
import { runWeeklyRollover } from "../services/rollover";

/**
 * Closes finished weekly periods and snapshots their final rankings.
 *
 * Safe to run repeatedly, late, or twice at once. Scheduled in production; the
 * live ranking never depends on it having run.
 *
 *   bun run job:weekly-rollover
 */
const summary = await runWeeklyRollover(database, apiConfig.product, new Date());
log.info(
  `Weekly rollover: closed ${summary.closedPeriods} period(s), ` +
    `snapshotted ${summary.snapshotted} creator ranking(s)` +
    (summary.champion === null ? "." : `, champion @${summary.champion}.`),
);
await closeDatabase(database);
