import { describe, expect, test } from "bun:test";
import {
  clickThroughRate,
  DELIVERY_SURFACES,
  type DeliverySurface,
  hourBucket,
  IMPRESSION_BATCH_MAX,
  isDeliverySurface,
  validateImpressionBatch,
} from "../src";

describe("the hour bucket", () => {
  test("truncates an instant to the hour it belongs to", () => {
    expect(hourBucket(new Date("2026-08-19T18:47:31.412Z")).toISOString()).toBe(
      "2026-08-19T18:00:00.000Z",
    );
  });

  test("leaves an instant already on the hour alone", () => {
    expect(hourBucket(new Date("2026-08-19T18:00:00.000Z")).toISOString()).toBe(
      "2026-08-19T18:00:00.000Z",
    );
  });

  test("puts the last millisecond of an hour in that hour, not the next", () => {
    expect(hourBucket(new Date("2026-08-19T18:59:59.999Z")).toISOString()).toBe(
      "2026-08-19T18:00:00.000Z",
    );
  });

  test("is UTC, so a local timezone cannot shift a bucket", () => {
    // Deduplication keys must not depend on where the server happens to run.
    expect(hourBucket(new Date("2026-01-01T00:30:00.000Z")).toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  test("refuses an invalid instant rather than bucketing a NaN", () => {
    expect(() => hourBucket(new Date("not a date"))).toThrow();
  });
});

describe("delivery surfaces", () => {
  test("recognises exactly the surfaces the schema stores", () => {
    for (const surface of DELIVERY_SURFACES) {
      expect(isDeliverySurface(surface)).toBe(true);
    }
    expect(isDeliverySurface("RANKING")).toBe(false);
    expect(isDeliverySurface("")).toBe(false);
  });
});

describe("an impression batch", () => {
  const surface: DeliverySurface = "LEADERBOARD";
  const id = "11111111-1111-4111-8111-111111111111";

  test("keeps one entry per creator and surface", () => {
    const batch = validateImpressionBatch([
      { creatorId: id, surface },
      { creatorId: id, surface },
      { creatorId: id, surface: "ROTATION" },
    ]);
    expect(batch).toEqual([
      { creatorId: id, surface: "LEADERBOARD" },
      { creatorId: id, surface: "ROTATION" },
    ]);
  });

  test("refuses more entries than one page could honestly produce", () => {
    const oversized = Array.from({ length: IMPRESSION_BATCH_MAX + 1 }, (_, index) => ({
      creatorId: `1111111${index.toString().padStart(1, "0")}-1111-4111-8111-111111111111`,
      surface,
    }));
    expect(() => validateImpressionBatch(oversized)).toThrow(/lote/i);
  });

  test("accepts a batch exactly at the limit", () => {
    const exact = Array.from({ length: IMPRESSION_BATCH_MAX }, (_, index) => ({
      creatorId: `${index.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`,
      surface,
    }));
    expect(validateImpressionBatch(exact)).toHaveLength(IMPRESSION_BATCH_MAX);
  });

  test("refuses an empty batch", () => {
    expect(() => validateImpressionBatch([])).toThrow(/lote/i);
  });
});

describe("click-through rate", () => {
  test("is clicks over impressions", () => {
    expect(clickThroughRate(25, 100)).toBe(0.25);
  });

  test("is null when nothing was ever shown", () => {
    // Zero over zero is not zero percent; it is a rate nobody can state.
    expect(clickThroughRate(0, 0)).toBeNull();
    expect(clickThroughRate(3, 0)).toBeNull();
  });

  test("never claims more clicks than impressions", () => {
    // Deduplication windows differ, so a burst can momentarily invert them.
    // A CTR above 100% is always a measurement artefact, never a fact.
    expect(clickThroughRate(120, 100)).toBe(1);
  });

  test("refuses negative counts rather than reporting a negative rate", () => {
    expect(() => clickThroughRate(-1, 10)).toThrow();
    expect(() => clickThroughRate(1, -10)).toThrow();
  });
});
