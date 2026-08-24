import { describe, expect, test } from "bun:test";
import {
  getWeeklyPeriod,
  isWithinPeriod,
  millisecondsRemainingInPeriod,
  timeZoneOffsetMs,
  toWallClock,
} from "../src/periods";

const TZ = "America/Sao_Paulo";

/** Local wall clock rendered back from a UTC instant, for readable assertions. */
function localIso(instant: Date): string {
  const wall = toWallClock(instant, TZ);
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}`;
}

describe("weekly period", () => {
  test("runs from local Monday 00:00 to the next local Monday 00:00", () => {
    // Wednesday 2026-08-19 15:30 in Sao Paulo.
    const period = getWeeklyPeriod(new Date("2026-08-19T18:30:00.000Z"), TZ);
    expect(localIso(period.startsAt)).toBe("2026-08-17T00:00:00");
    expect(localIso(period.endsAt)).toBe("2026-08-24T00:00:00");
    expect(period.type).toBe("WEEKLY");
  });

  test("persists boundaries as UTC instants offset from Sao Paulo local time", () => {
    const period = getWeeklyPeriod(new Date("2026-08-19T18:30:00.000Z"), TZ);
    expect(period.startsAt.toISOString()).toBe("2026-08-17T03:00:00.000Z");
    expect(period.endsAt.toISOString()).toBe("2026-08-24T03:00:00.000Z");
  });

  test("a Monday at local 00:00:00 opens the new period rather than closing the old one", () => {
    const mondayMidnightUtc = new Date("2026-08-17T03:00:00.000Z");
    const period = getWeeklyPeriod(mondayMidnightUtc, TZ);
    expect(period.startsAt.getTime()).toBe(mondayMidnightUtc.getTime());
    expect(isWithinPeriod(mondayMidnightUtc, period)).toBe(true);
  });

  test("the last millisecond before local Monday belongs to the closing period", () => {
    const justBefore = new Date("2026-08-17T02:59:59.999Z");
    const period = getWeeklyPeriod(justBefore, TZ);
    expect(localIso(period.startsAt)).toBe("2026-08-10T00:00:00");
    expect(period.endsAt.toISOString()).toBe("2026-08-17T03:00:00.000Z");
    expect(isWithinPeriod(justBefore, period)).toBe(true);
    expect(isWithinPeriod(period.endsAt, period)).toBe(false);
  });

  test("the boundary is Sao Paulo local midnight, not UTC midnight", () => {
    // 2026-08-17T01:00Z is already Monday in UTC but still Sunday 22:00 in Sao Paulo.
    const stillSunday = new Date("2026-08-17T01:00:00.000Z");
    expect(localIso(stillSunday)).toBe("2026-08-16T22:00:00");
    const period = getWeeklyPeriod(stillSunday, TZ);
    expect(localIso(period.startsAt)).toBe("2026-08-10T00:00:00");
  });

  test("the period is determined by the instant, never by when a job runs", () => {
    const atMidnight = getWeeklyPeriod(new Date("2026-08-17T03:00:00.000Z"), TZ);
    const sevenMinutesLate = getWeeklyPeriod(new Date("2026-08-17T03:07:00.000Z"), TZ);
    const hoursLate = getWeeklyPeriod(new Date("2026-08-17T14:00:00.000Z"), TZ);
    expect(sevenMinutesLate).toEqual(atMidnight);
    expect(hoursLate).toEqual(atMidnight);
  });

  test("consecutive periods tile the timeline with no gap or overlap", () => {
    const now = new Date("2026-08-19T18:30:00.000Z");
    const previous = getWeeklyPeriod(now, TZ, -1);
    const current = getWeeklyPeriod(now, TZ);
    const next = getWeeklyPeriod(now, TZ, 1);
    expect(previous.endsAt.getTime()).toBe(current.startsAt.getTime());
    expect(current.endsAt.getTime()).toBe(next.startsAt.getTime());
  });

  test("every week is exactly seven local days across a whole year", () => {
    for (let week = -26; week <= 26; week += 1) {
      const period = getWeeklyPeriod(new Date("2026-08-19T18:30:00.000Z"), TZ, week);
      const wall = toWallClock(period.startsAt, TZ);
      expect(wall.hour).toBe(0);
      expect(wall.minute).toBe(0);
      expect(wall.second).toBe(0);
      expect(new Date(period.startsAt).getTime()).toBeLessThan(period.endsAt.getTime());
    }
  });

  test("does not assume a permanent -03:00 offset", () => {
    // Brazil observed daylight saving time until 2019; the offset must come from
    // the zone database at the instant, not from a hard-coded constant.
    expect(timeZoneOffsetMs(new Date("2018-01-15T12:00:00.000Z"), TZ)).toBe(-2 * 3600 * 1000);
    expect(timeZoneOffsetMs(new Date("2026-08-19T12:00:00.000Z"), TZ)).toBe(-3 * 3600 * 1000);
  });

  test("resolves weekly boundaries correctly inside a historical DST week", () => {
    // Monday 2018-01-15 was inside Brazilian summer time (UTC-2).
    const period = getWeeklyPeriod(new Date("2018-01-17T12:00:00.000Z"), TZ);
    expect(period.startsAt.toISOString()).toBe("2018-01-15T02:00:00.000Z");
    expect(localIso(period.startsAt)).toBe("2018-01-15T00:00:00");
  });

  test("handles a period whose boundary crosses a DST transition", () => {
    // Brazilian DST ended on Sunday 2018-02-18; the following Monday is UTC-3
    // while the preceding week ran at UTC-2.
    const period = getWeeklyPeriod(new Date("2018-02-20T12:00:00.000Z"), TZ);
    expect(localIso(period.startsAt)).toBe("2018-02-19T00:00:00");
    expect(period.startsAt.toISOString()).toBe("2018-02-19T03:00:00.000Z");
    const previous = getWeeklyPeriod(new Date("2018-02-20T12:00:00.000Z"), TZ, -1);
    expect(localIso(previous.startsAt)).toBe("2018-02-12T00:00:00");
    expect(previous.startsAt.toISOString()).toBe("2018-02-12T02:00:00.000Z");
    expect(previous.endsAt.getTime()).toBe(period.startsAt.getTime());
  });

  test("countdown remainder never goes negative", () => {
    const period = getWeeklyPeriod(new Date("2026-08-19T18:30:00.000Z"), TZ);
    expect(millisecondsRemainingInPeriod(new Date("2026-08-23T03:00:00.000Z"), period)).toBe(
      24 * 3600 * 1000,
    );
    expect(millisecondsRemainingInPeriod(period.endsAt, period)).toBe(0);
    expect(millisecondsRemainingInPeriod(new Date("2030-01-01T00:00:00.000Z"), period)).toBe(0);
  });
});
