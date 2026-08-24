/**
 * Clicks per impression, as a fraction between 0 and 1.
 *
 * `null` when nothing was shown: zero clicks out of zero impressions is not a
 * rate of zero, it is a rate nobody can state, and a delivery report that
 * printed "0%" there would be claiming a measurement it never made.
 *
 * Impressions and clicks are deduplicated over different windows, so a burst
 * can briefly leave more clicks than impressions. A rate above 100% is always
 * an artefact of that, never a fact about delivery, so it is capped.
 */
export function clickThroughRate(clicks: number, impressions: number): number | null {
  if (clicks < 0 || impressions < 0) {
    throw new RangeError("Impressions and clicks are counts and cannot be negative");
  }
  if (impressions === 0) {
    return null;
  }
  return Math.min(1, clicks / impressions);
}
