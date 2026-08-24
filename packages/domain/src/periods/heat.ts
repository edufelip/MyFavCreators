import type { WeeklyPeriod } from "./weekly";

/** The final stretch of a weekly period, when the ranking is about to lock in. */
export const HEAT_MODE_HOURS = 24;

/**
 * Whether the week is in its closing hours.
 *
 * Heat mode changes styling only. It never changes how a ranking is calculated,
 * what a boost buys, or when a period ends — it is a way of saying "this is
 * decided today", not a different set of rules.
 */
export function isHeatMode(now: Date, period: WeeklyPeriod, hours = HEAT_MODE_HOURS): boolean {
  const remaining = period.endsAt.getTime() - now.getTime();
  return remaining > 0 && remaining <= hours * 60 * 60 * 1000;
}
