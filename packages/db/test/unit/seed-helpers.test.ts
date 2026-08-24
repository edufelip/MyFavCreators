import { describe, expect, test } from "bun:test";
import { CREATOR_PLATFORMS } from "@creator-outdoor/domain";
import {
  DeterministicRandom,
  deterministicUuid,
  splitIntoBoostAmounts,
} from "../../src/seed/deterministic";
import { CATEGORY_FIXTURES, CREATOR_FIXTURES } from "../../src/seed/fixtures";
import { describeCreatorLink } from "../../src/seed/links";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("deterministicUuid", () => {
  test("produces a stable version 5 UUID", () => {
    const first = deterministicUuid("creator:luna-verso");
    expect(first).toMatch(UUID_PATTERN);
    expect(deterministicUuid("creator:luna-verso")).toBe(first);
  });

  test("different names produce different identifiers", () => {
    expect(deterministicUuid("creator:a")).not.toBe(deterministicUuid("creator:b"));
  });
});

describe("splitIntoBoostAmounts", () => {
  test("always sums to the requested total", () => {
    const random = new DeterministicRandom("split");
    for (const total of [500, 800, 1500, 4300, 21_400, 48_700, 218_900]) {
      const parts = splitIntoBoostAmounts(total, random, 500);
      expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total);
    }
  });

  test("never produces a part below the minimum boost", () => {
    const random = new DeterministicRandom("split-min");
    for (const total of [500, 600, 900, 1100, 9_800, 132_400]) {
      for (const part of splitIntoBoostAmounts(total, random, 500)) {
        expect(part).toBeGreaterThanOrEqual(500);
        expect(Number.isInteger(part)).toBe(true);
      }
    }
  });

  test("is reproducible for the same seed", () => {
    const a = splitIntoBoostAmounts(48_700, new DeterministicRandom("seed"), 500);
    const b = splitIntoBoostAmounts(48_700, new DeterministicRandom("seed"), 500);
    expect(a).toEqual(b);
  });
});

describe("describeCreatorLink", () => {
  test("builds the canonical URL shape for every supported platform", () => {
    expect(describeCreatorLink("INSTAGRAM", "rafaonda")).toEqual({
      url: "https://instagram.com/rafaonda",
      handle: "rafaonda",
      normalizedKey: "instagram:rafaonda",
    });
    expect(describeCreatorLink("YOUTUBE", "lunaverso").normalizedKey).toBe("youtube:@lunaverso");
    expect(describeCreatorLink("TIKTOK", "teobaiao").url).toBe("https://tiktok.com/@teobaiao");
    expect(describeCreatorLink("TWITCH", "ninareverb").normalizedKey).toBe("twitch:ninareverb");
    expect(describeCreatorLink("X", "biametronomo").url).toBe("https://x.com/biametronomo");
    expect(describeCreatorLink("SUBSTACK", "sabiaeletrico").url).toBe(
      "https://sabiaeletrico.substack.com",
    );
    expect(describeCreatorLink("WEBSITE", "exemplo").normalizedKey).toBe("site:exemplo.com.br");
  });

  test("covers every supported platform", () => {
    for (const platform of CREATOR_PLATFORMS) {
      const descriptor = describeCreatorLink(platform, "exemplo");
      expect(descriptor.url.startsWith("https://")).toBe(true);
      expect(descriptor.normalizedKey.length).toBeGreaterThan(0);
    }
  });
});

describe("fixtures", () => {
  test("seeds the thirteen launch categories with only musica active", () => {
    expect(CATEGORY_FIXTURES).toHaveLength(13);
    expect(CATEGORY_FIXTURES.filter((category) => category.isActive).map((c) => c.slug)).toEqual([
      "musica",
    ]);
  });

  test("seeds fifteen creators with unique slugs and handles", () => {
    expect(CREATOR_FIXTURES).toHaveLength(15);
    expect(new Set(CREATOR_FIXTURES.map((creator) => creator.slug)).size).toBe(15);
    expect(new Set(CREATOR_FIXTURES.map((creator) => creator.handle)).size).toBe(15);
  });

  test("reproduces the documented Take #1 example between the top two creators", () => {
    const [leader, challenger] = CREATOR_FIXTURES;
    expect(leader?.currentWeekCents).toBe(48_700);
    expect(challenger?.currentWeekCents).toBe(39_300);
    // R$487 - R$393 + R$1 = R$95
    expect((leader?.currentWeekCents ?? 0) - (challenger?.currentWeekCents ?? 0) + 100).toBe(9_500);
  });

  test("every seeded amount is a whole number of centavos", () => {
    for (const fixture of CREATOR_FIXTURES) {
      expect(Number.isInteger(fixture.currentWeekCents)).toBe(true);
      expect(Number.isInteger(fixture.historicalCents)).toBe(true);
    }
  });
});
