export type WallClock = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function requirePart(parts: readonly Intl.DateTimeFormatPart[], type: string): number {
  const part = parts.find((candidate) => candidate.type === type);
  if (part === undefined) {
    throw new RangeError(`Time zone formatting did not produce a "${type}" part`);
  }
  const value = Number.parseInt(part.value, 10);
  if (!Number.isFinite(value)) {
    throw new RangeError(`Time zone formatting produced a non-numeric "${type}" part`);
  }
  return value;
}

/** The local wall-clock reading of an instant in an IANA time zone. */
export function toWallClock(instant: Date, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(instant);
  return {
    year: requirePart(parts, "year"),
    month: requirePart(parts, "month"),
    day: requirePart(parts, "day"),
    hour: requirePart(parts, "hour"),
    minute: requirePart(parts, "minute"),
    second: requirePart(parts, "second"),
  };
}

function wallClockAsPseudoUtc(wall: WallClock): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/**
 * The zone's UTC offset in milliseconds at a given instant.
 *
 * Derived from the zone database at that instant, never assumed: Brazil has
 * abolished and reinstated daylight saving time before, so a hard-coded -03:00
 * would silently corrupt weekly period boundaries if it ever returns.
 */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  return wallClockAsPseudoUtc(toWallClock(instant, timeZone)) - instant.getTime();
}

/**
 * Resolves a local wall-clock reading back to the UTC instant it names.
 *
 * The offset depends on the answer, so we converge: guess with the offset at the
 * pseudo-UTC instant, then re-resolve with the offset actually in force there.
 * Across a daylight-saving gap the named local time does not exist; we then use
 * the post-transition offset, which lands on the instant the clock jumped to.
 */
export function wallClockToInstant(wall: WallClock, timeZone: string): Date {
  const pseudoUtc = wallClockAsPseudoUtc(wall);
  const firstGuess = new Date(pseudoUtc - timeZoneOffsetMs(new Date(pseudoUtc), timeZone));
  const refinedOffset = timeZoneOffsetMs(firstGuess, timeZone);
  const candidate = new Date(pseudoUtc - refinedOffset);
  const candidateOffset = timeZoneOffsetMs(candidate, timeZone);
  if (candidateOffset === refinedOffset) {
    return candidate;
  }
  return new Date(pseudoUtc - candidateOffset);
}

/** Day of week for a wall-clock date: 0 = Sunday ... 6 = Saturday. */
export function wallClockDayOfWeek(wall: WallClock): number {
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
}
