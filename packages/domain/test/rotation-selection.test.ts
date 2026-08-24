import { describe, expect, test } from "bun:test";
import { type RotationCandidate, rotationBucket, selectRotation } from "../src/rotation";

const NOW = new Date("2026-08-19T18:30:00.000Z");

function candidates(count: number, hoursLeft = 5): RotationCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    creatorId: `creator-${String(index).padStart(3, "0")}`,
    rotationEndsAt: new Date(NOW.getTime() + hoursLeft * 60 * 60 * 1000),
  }));
}

describe("rotation bucket", () => {
  test("advances every configured interval", () => {
    const first = rotationBucket(NOW, 5);
    expect(rotationBucket(new Date(NOW.getTime() + 4 * 60_000), 5)).toBe(first);
    expect(rotationBucket(new Date(NOW.getTime() + 5 * 60_000), 5)).toBe(first + 1);
  });

  test("refuses a nonsensical interval", () => {
    expect(() => rotationBucket(NOW, 0)).toThrow(RangeError);
    expect(() => rotationBucket(NOW, 1.5)).toThrow(RangeError);
  });
});

describe("rotation selection", () => {
  test("shows at most the configured maximum", () => {
    const selected = selectRotation({
      candidates: candidates(100),
      now: NOW,
      bucketMinutes: 5,
      maxVisible: 30,
    });
    expect(selected).toHaveLength(30);
  });

  test("is stable within a bucket", () => {
    const pool = candidates(100);
    const first = selectRotation({ candidates: pool, now: NOW, bucketMinutes: 5, maxVisible: 30 });
    const later = selectRotation({
      candidates: pool,
      now: new Date(NOW.getTime() + 4 * 60_000),
      bucketMinutes: 5,
      maxVisible: 30,
    });
    expect(later.map((entry) => entry.creatorId)).toEqual(first.map((entry) => entry.creatorId));
  });

  test("rotates when the bucket advances", () => {
    const pool = candidates(100);
    const first = selectRotation({ candidates: pool, now: NOW, bucketMinutes: 5, maxVisible: 30 });
    const next = selectRotation({
      candidates: pool,
      now: new Date(NOW.getTime() + 5 * 60_000),
      bucketMinutes: 5,
      maxVisible: 30,
    });
    expect(next.map((entry) => entry.creatorId)).not.toEqual(first.map((entry) => entry.creatorId));
  });

  test("does not order by recency: the newest entitlement is not favoured", () => {
    // Every candidate is entitled; the one added last must not systematically
    // appear first, or the 24-hour entitlement would be misleading.
    const pool = candidates(60);
    const positions: number[] = [];
    for (let bucket = 0; bucket < 40; bucket += 1) {
      const selected = selectRotation({
        candidates: pool,
        now: new Date(NOW.getTime() + bucket * 5 * 60_000),
        bucketMinutes: 5,
        maxVisible: 30,
      });
      const index = selected.findIndex((entry) => entry.creatorId === "creator-059");
      if (index >= 0) {
        positions.push(index);
      }
    }
    // It appears sometimes, and not always in the same place.
    expect(positions.length).toBeGreaterThan(5);
    expect(new Set(positions).size).toBeGreaterThan(1);
  });

  test("gives every entitled creator a turn over time", () => {
    const pool = candidates(60);
    const seen = new Set<string>();
    for (let bucket = 0; bucket < 60; bucket += 1) {
      for (const entry of selectRotation({
        candidates: pool,
        now: new Date(NOW.getTime() + bucket * 5 * 60_000),
        bucketMinutes: 5,
        maxVisible: 30,
      })) {
        seen.add(entry.creatorId);
      }
    }
    expect(seen.size).toBe(pool.length);
  });

  test("is roughly even across entitled creators", () => {
    // The entitlement has to outlast the measurement window, or the later
    // rounds measure an empty pool rather than the selection.
    const rounds = 400;
    const pool = candidates(60, (rounds * 5) / 60 + 1);
    const appearances = new Map<string, number>();
    for (let bucket = 0; bucket < rounds; bucket += 1) {
      for (const entry of selectRotation({
        candidates: pool,
        now: new Date(NOW.getTime() + bucket * 5 * 60_000),
        bucketMinutes: 5,
        maxVisible: 30,
      })) {
        appearances.set(entry.creatorId, (appearances.get(entry.creatorId) ?? 0) + 1);
      }
    }
    const counts = [...appearances.values()];
    const expected = (rounds * 30) / pool.length;
    // Half the pool is shown each round, so every creator should land near half
    // the rounds. A wide band still catches a selection that favours a subset.
    for (const count of counts) {
      expect(count).toBeGreaterThan(expected * 0.6);
      expect(count).toBeLessThan(expected * 1.4);
    }
  });

  test("drops a creator the moment the entitlement expires", () => {
    const pool: RotationCandidate[] = [
      { creatorId: "expiring", rotationEndsAt: new Date(NOW.getTime() + 1000) },
      { creatorId: "active", rotationEndsAt: new Date(NOW.getTime() + 60 * 60 * 1000) },
    ];
    const before = selectRotation({ candidates: pool, now: NOW, bucketMinutes: 5, maxVisible: 30 });
    expect(before.map((entry) => entry.creatorId).sort()).toEqual(["active", "expiring"]);

    const after = selectRotation({
      candidates: pool,
      now: new Date(NOW.getTime() + 1001),
      bucketMinutes: 5,
      maxVisible: 30,
    });
    expect(after.map((entry) => entry.creatorId)).toEqual(["active"]);
  });

  test("handles an empty or tiny pool", () => {
    expect(selectRotation({ candidates: [], now: NOW, bucketMinutes: 5, maxVisible: 30 })).toEqual(
      [],
    );
    expect(
      selectRotation({ candidates: candidates(3), now: NOW, bucketMinutes: 5, maxVisible: 30 }),
    ).toHaveLength(3);
  });

  test("is independent of the order candidates arrive in", () => {
    const pool = candidates(50);
    const forwards = selectRotation({
      candidates: pool,
      now: NOW,
      bucketMinutes: 5,
      maxVisible: 30,
    });
    const backwards = selectRotation({
      candidates: [...pool].reverse(),
      now: NOW,
      bucketMinutes: 5,
      maxVisible: 30,
    });
    expect(backwards.map((entry) => entry.creatorId)).toEqual(
      forwards.map((entry) => entry.creatorId),
    );
  });
});
