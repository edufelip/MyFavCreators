import { toWallClock, wallClockDayOfWeek, wallClockToInstant } from "./timezone";

export const RANKING_PERIOD_TYPES = ["WEEKLY", "ALL_TIME"] as const;
export type RankingPeriodType = (typeof RANKING_PERIOD_TYPES)[number];

export const RANKING_PERIOD_STATUSES = ["OPEN", "CLOSED"] as const;
export type RankingPeriodStatus = (typeof RANKING_PERIOD_STATUSES)[number];

/**
 * A half-open ranking window `[startsAt, endsAt)` expressed as UTC instants.
 *
 * The boundaries are local Monday 00:00:00 in the configured time zone, so the
 * window is a pure function of the instant. Nothing about it depends on when a
 * rollover job happens to run: a job executing at Monday 00:07 still closes a
 * period that ended at Monday 00:00.
 */
export type WeeklyPeriod = {
  readonly type: "WEEKLY";
  readonly startsAt: Date;
  readonly endsAt: Date;
};

const DAYS_PER_WEEK = 7;

function startOfWeekInstant(reference: Date, timeZone: string, weekOffset: number): Date {
  const wall = toWallClock(reference, timeZone);
  const daysSinceMonday = (wallClockDayOfWeek(wall) + 6) % DAYS_PER_WEEK;
  return wallClockToInstant(
    {
      year: wall.year,
      month: wall.month,
      day: wall.day - daysSinceMonday + weekOffset * DAYS_PER_WEEK,
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
}

/**
 * The weekly ranking period containing `now`.
 *
 * `weekOffset` selects a neighbouring week: `-1` is the previous period, `1` the
 * next one. Defaults to the current period.
 */
export function getWeeklyPeriod(now: Date, timeZone: string, weekOffset = 0): WeeklyPeriod {
  const startsAt = startOfWeekInstant(now, timeZone, weekOffset);
  const endsAt = startOfWeekInstant(now, timeZone, weekOffset + 1);
  return { type: "WEEKLY", startsAt, endsAt };
}

export function isWithinPeriod(instant: Date, period: WeeklyPeriod): boolean {
  const time = instant.getTime();
  return time >= period.startsAt.getTime() && time < period.endsAt.getTime();
}

/** Milliseconds until the period closes, floored at zero. */
export function millisecondsRemainingInPeriod(now: Date, period: WeeklyPeriod): number {
  return Math.max(0, period.endsAt.getTime() - now.getTime());
}
