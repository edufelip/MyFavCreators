/**
 * The hour an event belongs to, in UTC.
 *
 * Deduplication keys are built from this, so it must not depend on where the
 * server happens to run: a bucket that shifted with a local timezone would let
 * the same impression count twice simply because two processes disagreed.
 */
export function hourBucket(instant: Date): Date {
  const time = instant.getTime();
  if (!Number.isFinite(time)) {
    throw new RangeError("An hour bucket needs a valid instant");
  }
  const bucketed = new Date(time);
  bucketed.setUTCMinutes(0, 0, 0);
  return bucketed;
}
