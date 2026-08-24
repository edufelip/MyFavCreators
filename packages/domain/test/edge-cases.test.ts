import { describe, expect, test } from "bun:test";
import {
  clickThroughRate,
  InvalidEmailError,
  maxCents,
  moneyCents,
  normalizeEmail,
  parseMoneyCents,
  rankCreators,
  redactEmail,
} from "../src";

/**
 * Edge cases written against mutation testing rather than line coverage: every
 * case here exists because flipping the rule it covers has to fail something.
 * These are the boundaries where an off-by-one costs money, hides a supporter
 * or lets an address through.
 */

describe("parsing money that crossed an untyped boundary", () => {
  test("reads a bigint a SQL aggregate returns", () => {
    expect(parseMoneyCents(12_300n)).toBe(moneyCents(12_300));
    expect(parseMoneyCents(0n)).toBe(moneyCents(0));
  });

  test("reads the largest bigint that is still a safe number", () => {
    const largest = BigInt(Number.MAX_SAFE_INTEGER);
    expect(parseMoneyCents(largest)).toBe(moneyCents(Number.MAX_SAFE_INTEGER));
  });

  test("refuses a bigint one past what a number can hold", () => {
    // Silently rounding here would misreport a total, which is the one thing
    // money code may never do.
    expect(() => parseMoneyCents(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow();
  });

  test("refuses a negative bigint", () => {
    expect(() => parseMoneyCents(-1n)).toThrow();
  });

  test("reads a numeric string but not a decimal one", () => {
    expect(parseMoneyCents("500")).toBe(moneyCents(500));
    expect(() => parseMoneyCents("5.00")).toThrow();
    expect(() => parseMoneyCents("-500")).toThrow();
    expect(() => parseMoneyCents("")).toThrow();
    expect(() => parseMoneyCents(" 500 ")).toThrow();
  });

  test("refuses anything else outright", () => {
    for (const value of [null, undefined, {}, [], true, Number.NaN, 1.5, -1]) {
      expect(() => parseMoneyCents(value), String(value)).toThrow();
    }
  });
});

describe("the larger of two amounts", () => {
  test("is the larger one", () => {
    expect(maxCents(moneyCents(500), moneyCents(900))).toBe(moneyCents(900));
    expect(maxCents(moneyCents(900), moneyCents(500))).toBe(moneyCents(900));
  });

  test("is that amount when both are equal", () => {
    expect(maxCents(moneyCents(500), moneyCents(500))).toBe(moneyCents(500));
  });
});

describe("ordering creators with no counted money", () => {
  function creator(id: string, amountCents: number, reachedAt: Date | null) {
    return {
      creatorId: id,
      amountCents: moneyCents(amountCents),
      reachedCurrentScoreAt: reachedAt,
      creatorCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
  }

  test("sorts a creator who reached a score above one who never did", () => {
    /*
     * Both on zero: the one with a timestamp has actually been somewhere. The
     * ids are chosen so the last-resort alphabetical tiebreak would give the
     * *opposite* order — otherwise this passes whether or not the rule works.
     */
    const ranked = rankCreators([
      creator("a-sem-data", 0, null),
      creator("z-com-data", 0, new Date("2026-08-19T10:00:00.000Z")),
    ]);
    expect(ranked.map((entry) => entry.creatorId)).toEqual(["z-com-data", "a-sem-data"]);
  });

  test("sorts the same way whichever order they arrive in", () => {
    const ranked = rankCreators([
      creator("z-com-data", 0, new Date("2026-08-19T10:00:00.000Z")),
      creator("a-sem-data", 0, null),
    ]);
    expect(ranked.map((entry) => entry.creatorId)).toEqual(["z-com-data", "a-sem-data"]);
  });

  test("falls through to the joining date when neither reached anything", () => {
    const older = {
      ...creator("antiga", 0, null),
      creatorCreatedAt: new Date("2025-01-01T00:00:00.000Z"),
    };
    const ranked = rankCreators([creator("nova", 0, null), older]);
    expect(ranked.map((entry) => entry.creatorId)).toEqual(["antiga", "nova"]);
  });

  test("numbers positions from one, with no gaps and no ties", () => {
    const ranked = rankCreators([
      creator("a", 300, new Date("2026-08-19T10:00:00.000Z")),
      creator("b", 200, new Date("2026-08-19T10:00:00.000Z")),
      creator("c", 100, new Date("2026-08-19T10:00:00.000Z")),
    ]);
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2, 3]);
  });

  test("puts the first to reach a score ahead of a later one", () => {
    const ranked = rankCreators([
      creator("depois", 500, new Date("2026-08-19T11:00:00.000Z")),
      creator("antes", 500, new Date("2026-08-19T10:00:00.000Z")),
    ]);
    expect(ranked.map((entry) => entry.creatorId)).toEqual(["antes", "depois"]);
  });
});

describe("email boundaries", () => {
  test("accepts an address exactly at the length limit", () => {
    const local = "a".repeat(254 - "@example.com".length);
    expect(normalizeEmail(`${local}@example.com`)).toHaveLength(254);
  });

  test("refuses an address one character past it", () => {
    const local = "a".repeat(255 - "@example.com".length);
    expect(() => normalizeEmail(`${local}@example.com`)).toThrow(InvalidEmailError);
  });

  test("requires something on both sides of the at sign", () => {
    expect(() => normalizeEmail("@example.com")).toThrow();
    expect(() => normalizeEmail("ana@")).toThrow();
  });

  test("requires a dot in the domain, and something after it", () => {
    expect(() => normalizeEmail("ana@example")).toThrow();
    expect(() => normalizeEmail("ana@example.")).toThrow();
    expect(() => normalizeEmail("ana@.com")).toThrow();
  });

  test("accepts a multi-level domain", () => {
    expect(normalizeEmail("ana@mail.example.com.br")).toBe("ana@mail.example.com.br");
  });

  test("refuses an address with a space anywhere", () => {
    expect(() => normalizeEmail("an a@example.com")).toThrow();
    expect(() => normalizeEmail("ana@exa mple.com")).toThrow();
  });

  test("refuses a second at sign", () => {
    expect(() => normalizeEmail("ana@example@com")).toThrow();
  });
});

describe("redacting an address", () => {
  test("keeps the first character and the whole domain", () => {
    expect(redactEmail("bruna@example.com")).toBe("b***@example.com");
  });

  test("keeps nothing at all of a one-character local part", () => {
    expect(redactEmail("b@example.com")).toBe("***@example.com");
  });

  test("collapses anything that is not an address", () => {
    for (const value of ["", "ana", "@", "ana@", "@example.com", "ana@example"]) {
      expect(redactEmail(value), value).toBe("***");
    }
  });
});

describe("click-through rate boundaries", () => {
  test("is zero when nothing was clicked but something was shown", () => {
    // Distinct from null: this is a real measurement of no clicks.
    expect(clickThroughRate(0, 100)).toBe(0);
  });

  test("is one when every impression was clicked", () => {
    expect(clickThroughRate(100, 100)).toBe(1);
  });

  test("is capped rather than reported above one", () => {
    expect(clickThroughRate(101, 100)).toBe(1);
  });
});
