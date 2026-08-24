import type { Database, DatabaseExecutor } from "./client";

/**
 * Runs work inside a single database transaction.
 *
 * Financial state is never eventually consistent: payment transitions, boost
 * activation, refunds, moderation eligibility and snapshots all commit or none
 * of them do. Analytics deliberately stays outside this boundary.
 */
export function withTransaction<TResult>(
  database: Database,
  work: (tx: DatabaseExecutor) => Promise<TResult>,
): Promise<TResult> {
  return database.transaction((tx) => work(tx));
}
