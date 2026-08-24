import { describe, expect, test } from "bun:test";
import { moneyCents } from "../src/money";
import {
  calculateRankMovement,
  deriveCurrentScore,
  deriveCurrentScoreReachedAt,
  type RankableCreator,
  rankCreators,
} from "../src/ranking";
import { cents } from "./support";

const JOINED = new Date("2026-01-01T00:00:00.000Z");

function creator(
  creatorId: string,
  amount: number,
  reachedAt: string | null,
  createdAt: Date = JOINED,
): RankableCreator {
  return {
    creatorId,
    amountCents: moneyCents(amount),
    reachedCurrentScoreAt: reachedAt === null ? null : new Date(reachedAt),
    creatorCreatedAt: createdAt,
  };
}

describe("rankCreators", () => {
  test("orders by score, highest first", () => {
    const ranked = rankCreators([
      creator("b", 39300, "2026-08-18T10:00:00.000Z"),
      creator("a", 48700, "2026-08-18T11:00:00.000Z"),
      creator("c", 12000, "2026-08-18T09:00:00.000Z"),
    ]);
    expect(ranked.map((entry) => entry.creatorId)).toEqual(["a", "b", "c"]);
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2, 3]);
  });

  test("breaks a score tie in favour of whoever reached the score first", () => {
    const ranked = rankCreators([
      creator("late", 10000, "2026-08-18T11:00:00.000Z"),
      creator("early", 10000, "2026-08-18T10:00:00.000Z"),
    ]);
    expect(ranked.map((entry) => entry.creatorId)).toEqual(["early", "late"]);
  });

  test("falls back to creator.createdAt when score and timestamp both tie", () => {
    const ranked = rankCreators([
      creator("newer", 10000, "2026-08-18T10:00:00.000Z", new Date("2026-02-01T00:00:00.000Z")),
      creator("older", 10000, "2026-08-18T10:00:00.000Z", new Date("2026-01-01T00:00:00.000Z")),
    ]);
    expect(ranked.map((entry) => entry.creatorId)).toEqual(["older", "newer"]);
  });

  test("sorts creators with no counted money last among equals", () => {
    const ranked = rankCreators([creator("silent", 0, null), creator("scored", 0, null)]);
    expect(ranked).toHaveLength(2);
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2]);
  });

  test("produces a total order with no shared positions", () => {
    const ranked = rankCreators([
      creator("a", 5000, "2026-08-18T10:00:00.000Z"),
      creator("b", 5000, "2026-08-18T10:00:00.000Z"),
      creator("c", 5000, "2026-08-18T10:00:00.000Z"),
    ]);
    expect(new Set(ranked.map((entry) => entry.rank)).size).toBe(3);
  });

  test("is deterministic regardless of input order", () => {
    const entries = [
      creator("a", 48700, "2026-08-18T11:00:00.000Z"),
      creator("b", 39300, "2026-08-18T10:00:00.000Z"),
      creator("c", 39300, "2026-08-18T09:00:00.000Z"),
    ];
    const forwards = rankCreators(entries).map((entry) => entry.creatorId);
    const backwards = rankCreators([...entries].reverse()).map((entry) => entry.creatorId);
    expect(backwards).toEqual(forwards);
    expect(forwards).toEqual(["a", "c", "b"]);
  });

  test("does not mutate the input array", () => {
    const entries = [
      creator("b", 100, "2026-08-18T10:00:00.000Z"),
      creator("a", 900, "2026-08-18T10:00:00.000Z"),
    ];
    rankCreators(entries);
    expect(entries.map((entry) => entry.creatorId)).toEqual(["b", "a"]);
  });

  test("ranks an empty leaderboard without failing", () => {
    expect(rankCreators([])).toEqual([]);
  });
});

describe("deriveCurrentScoreReachedAt", () => {
  test("is the most recent confirmation among the boosts currently counted", () => {
    const reachedAt = deriveCurrentScoreReachedAt([
      { amountCents: moneyCents(5000), confirmedAt: new Date("2026-08-18T10:00:00.000Z") },
      { amountCents: moneyCents(5000), confirmedAt: new Date("2026-08-18T11:00:00.000Z") },
    ]);
    expect(reachedAt?.toISOString()).toBe("2026-08-18T11:00:00.000Z");
  });

  test("falls back to the earlier timestamp when the later boost stops counting", () => {
    // The 11:00 boost was refunded, so only the 10:00 boost still contributes.
    // The refund time is never the time the lower score was reached.
    const contributions = [
      { amountCents: moneyCents(5000), confirmedAt: new Date("2026-08-18T10:00:00.000Z") },
    ];
    expect(cents(deriveCurrentScore(contributions))).toBe(5000);
    expect(deriveCurrentScoreReachedAt(contributions)?.toISOString()).toBe(
      "2026-08-18T10:00:00.000Z",
    );
  });

  test("a restored tie timestamp changes the ranking order back", () => {
    const rival = creator("rival", 5000, "2026-08-18T10:30:00.000Z");
    const before = rankCreators([creator("subject", 10000, "2026-08-18T11:00:00.000Z"), rival]);
    expect(before[0]?.creatorId).toBe("subject");

    const afterRefund = rankCreators([creator("subject", 5000, "2026-08-18T10:00:00.000Z"), rival]);
    expect(afterRefund[0]?.creatorId).toBe("subject");
    expect(afterRefund[0]?.reachedCurrentScoreAt?.toISOString()).toBe("2026-08-18T10:00:00.000Z");
  });

  test("is null with nothing counted", () => {
    expect(deriveCurrentScoreReachedAt([])).toBeNull();
    expect(cents(deriveCurrentScore([]))).toBe(0);
  });
});

describe("calculateRankMovement", () => {
  test("reports positions gained", () => {
    expect(calculateRankMovement(8, 1)).toEqual({
      fromRank: 8,
      toRank: 1,
      positionsGained: 7,
      direction: "UP",
    });
  });

  test("reports the real result when the quote did not reach #1", () => {
    expect(calculateRankMovement(8, 3)).toEqual({
      fromRank: 8,
      toRank: 3,
      positionsGained: 5,
      direction: "UP",
    });
  });

  test("reports no movement and downward movement honestly", () => {
    expect(calculateRankMovement(4, 4).direction).toBe("NONE");
    expect(calculateRankMovement(1, 2)).toEqual({
      fromRank: 1,
      toRank: 2,
      positionsGained: 0,
      direction: "DOWN",
    });
  });

  test("handles a creator entering the ranking for the first time", () => {
    expect(calculateRankMovement(null, 6)).toEqual({
      fromRank: null,
      toRank: 6,
      positionsGained: 0,
      direction: "NONE",
    });
  });
});
