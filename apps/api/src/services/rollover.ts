import type { ProductConfig } from "@creator-outdoor/config";
import {
  closePeriod,
  type Database,
  ensureWeeklyPeriod,
  getLeaderboardPage,
  replacePeriodSnapshots,
  withTransaction,
  writeAuditLog,
} from "@creator-outdoor/db";
import { getWeeklyPeriod, type WeeklyPeriod } from "@creator-outdoor/domain";

export type RolloverSummary = {
  readonly closedPeriods: number;
  readonly snapshotted: number;
  readonly champion: string | null;
};

const MAX_SNAPSHOT_ROWS = 1000;

/**
 * Snapshots a period's final ranking and closes it.
 *
 * Everything about this is safe to repeat. The snapshot write is an upsert keyed
 * by (creator, period), closing an already-closed period changes nothing, and
 * the ranking it records is derived from the boosts that count *right now* — so
 * running it late, twice, or concurrently produces the same rows.
 *
 * Nothing about the live ranking depends on this having run: the active period
 * is computed from the instant. A rollover executing at Monday 00:07 still
 * closes a period that ended at Monday 00:00, and boosts confirmed after
 * midnight already belong to the new week.
 */
export async function snapshotPeriod(
  database: Database,
  period: WeeklyPeriod,
  options: { readonly close: boolean; readonly now: Date; readonly actor: string },
): Promise<{ readonly snapshotted: number; readonly champion: string | null }> {
  const window = { startsAt: period.startsAt, endsAt: period.endsAt };
  const page = await getLeaderboardPage(database, {
    window,
    limit: MAX_SNAPSHOT_ROWS,
    offset: 0,
  });

  const periodRow = await ensureWeeklyPeriod(database, window);
  const champion = page.leader?.creatorSlug ?? null;

  await withTransaction(database, async (tx) => {
    await replacePeriodSnapshots(
      tx,
      periodRow.id,
      page.entries.map((entry) => ({
        creatorId: entry.creatorId,
        rank: entry.rank,
        amountCents: entry.amountCents,
        supporterCount: entry.supporterCount,
      })),
    );
    if (options.close) {
      await closePeriod(tx, periodRow.id, options.now);
      await writeAuditLog(tx, {
        actor: options.actor,
        action: "ranking_period.closed",
        targetType: "ranking_period",
        targetId: periodRow.id,
        metadata: {
          startsAt: period.startsAt.toISOString(),
          endsAt: period.endsAt.toISOString(),
          creators: page.entries.length,
          champion,
        },
      });
    }
  });

  return { snapshotted: page.entries.length, champion };
}

/**
 * Closes every weekly period that has already ended and is not closed yet.
 *
 * Looks back several weeks rather than only at the previous one, so a job that
 * did not run for a fortnight still closes everything it missed instead of
 * leaving a permanent hole in the Hall da Fama.
 */
export async function runWeeklyRollover(
  database: Database,
  product: ProductConfig,
  now: Date,
  lookBackWeeks = 8,
): Promise<RolloverSummary> {
  let closedPeriods = 0;
  let snapshotted = 0;
  let champion: string | null = null;

  for (let offset = lookBackWeeks; offset >= 1; offset -= 1) {
    const period = getWeeklyPeriod(now, product.timezone, -offset);
    if (period.endsAt.getTime() > now.getTime()) {
      continue;
    }
    const result = await snapshotPeriod(database, period, {
      close: true,
      now,
      actor: "job:weekly-rollover",
    });
    closedPeriods += 1;
    snapshotted += result.snapshotted;
    champion = result.champion ?? champion;
  }

  // The open period is created so the overtake ticker has somewhere to record.
  const current = getWeeklyPeriod(now, product.timezone);
  await ensureWeeklyPeriod(database, {
    startsAt: current.startsAt,
    endsAt: current.endsAt,
  });

  return { closedPeriods, snapshotted, champion };
}

/**
 * Recomputes a closed period after money moved inside it.
 *
 * A refund can land weeks after a period closed. Hall da Fama has to show
 * financially active boosts rather than stale history, so the snapshots are
 * recomputed from the boosts that still count — which may remove a creator
 * entirely, and may change who the champion was.
 */
export async function recomputeClosedPeriodFor(
  database: Database,
  product: ProductConfig,
  confirmedAt: Date,
  now: Date,
): Promise<boolean> {
  const period = getWeeklyPeriod(confirmedAt, product.timezone);
  if (period.endsAt.getTime() > now.getTime()) {
    // The period is still open; its ranking is derived live and needs no repair.
    return false;
  }
  await snapshotPeriod(database, period, {
    close: true,
    now,
    actor: "system:refund-correction",
  });
  return true;
}
