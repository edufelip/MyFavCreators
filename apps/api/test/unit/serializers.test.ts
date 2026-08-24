import { describe, expect, test } from "bun:test";
import { LeaderboardResponseDto, parseContract } from "@creator-outdoor/contracts";
import type { LeaderboardRow } from "@creator-outdoor/db";
import { getWeeklyPeriod, moneyCents } from "@creator-outdoor/domain";
import { serializeLeaderboard } from "../../src/serializers/rankings";

const PERIOD = getWeeklyPeriod(new Date("2026-08-19T18:30:00.000Z"), "America/Sao_Paulo");

function row(overrides: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    rank: 1,
    creatorId: "11111111-1111-4111-8111-111111111111",
    creatorSlug: "luna-verso",
    displayName: "Luna Verso",
    avatarUrl: null,
    creatorCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
    categorySlug: "musica",
    categoryName: "Música",
    primaryPlatform: "YOUTUBE",
    primaryHandle: "@lunaverso",
    amountCents: moneyCents(48_700),
    reachedCurrentScoreAt: new Date("2026-08-19T11:00:00.000Z"),
    supporterCount: 47,
    ...overrides,
  };
}

function serialize(rows: readonly LeaderboardRow[]) {
  const leader = rows.find((entry) => entry.rank === 1) ?? null;
  return serializeLeaderboard({
    period: PERIOD,
    entries: rows,
    leader,
    total: rows.length,
    generatedAt: new Date("2026-08-19T18:30:00.000Z"),
    minIncrementCents: 100,
    minBoostCents: 500,
  });
}

describe("leaderboard serializer", () => {
  test("satisfies the published contract", () => {
    const payload = serialize([
      row(),
      row({ rank: 2, creatorSlug: "mara-beats", amountCents: moneyCents(39_300) }),
    ]);
    expect(() =>
      parseContract(LeaderboardResponseDto, payload, "LeaderboardResponse"),
    ).not.toThrow();
  });

  test("exposes only allowlisted creator fields", () => {
    const payload = serialize([row()]);
    const creator = payload.entries[0]?.creator;
    expect(Object.keys(creator ?? {}).sort()).toEqual([
      "avatarUrl",
      "category",
      "displayName",
      "id",
      "primaryHandle",
      "primaryPlatform",
      "slug",
    ]);
  });

  test("exposes only allowlisted entry fields", () => {
    const payload = serialize([row()]);
    expect(Object.keys(payload.entries[0] ?? {}).sort()).toEqual([
      "amountCents",
      "creator",
      "rank",
      "reachedCurrentScoreAt",
      "supporterCount",
      "takeFirstPlaceAmountCents",
    ]);
  });

  test("never emits a private identifier anywhere in the payload", () => {
    const serialized = JSON.stringify(
      serialize([row(), row({ rank: 2, creatorSlug: "mara-beats" })]),
    );
    for (const forbidden of [
      "supporterEmail",
      "supporter_email",
      "supporterKey",
      "supporter_key",
      "fanIdentityKey",
      "fan_identity_key",
      "providerPaymentId",
      "provider_payment_id",
      "rawMetadata",
      "raw_metadata",
      "moderationStatus",
      "moderation_status",
      "sid",
      "sessionId",
      "normalizedKey",
      "normalized_key",
    ]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });

  test("does not leak the internal creator creation timestamp used for tie-breaks", () => {
    const payload = serialize([row()]);
    expect(JSON.stringify(payload).includes("creatorCreatedAt")).toBe(false);
  });

  test("hides Take #1 for the leader and quotes it for everybody else", () => {
    const payload = serialize([
      row(),
      row({ rank: 2, creatorSlug: "mara-beats", amountCents: moneyCents(39_300) }),
    ]);
    expect(payload.entries[0]?.takeFirstPlaceAmountCents).toBeNull();
    expect(payload.entries[1]?.takeFirstPlaceAmountCents).toBe(9_500);
  });

  test("keeps every monetary value an integer number of centavos", () => {
    const payload = serialize([row({ amountCents: moneyCents(9_990) })]);
    expect(Number.isInteger(payload.entries[0]?.amountCents ?? Number.NaN)).toBe(true);
    expect(payload.entries[0]?.amountCents).toBe(9_990);
  });

  test("describes the all-time ranking with no period boundaries", () => {
    const payload = serializeLeaderboard({
      period: null,
      entries: [row()],
      leader: row(),
      total: 1,
      generatedAt: new Date("2026-08-19T18:30:00.000Z"),
      minIncrementCents: 100,
      minBoostCents: 500,
    });
    expect(payload.period).toEqual({ type: "ALL_TIME" });
    expect(() =>
      parseContract(LeaderboardResponseDto, payload, "LeaderboardResponse"),
    ).not.toThrow();
  });

  test("serializes an empty leaderboard", () => {
    const payload = serializeLeaderboard({
      period: PERIOD,
      entries: [],
      leader: null,
      total: 0,
      generatedAt: new Date("2026-08-19T18:30:00.000Z"),
      minIncrementCents: 100,
      minBoostCents: 500,
    });
    expect(payload.leader).toBeNull();
    expect(payload.entries).toEqual([]);
    expect(() =>
      parseContract(LeaderboardResponseDto, payload, "LeaderboardResponse"),
    ).not.toThrow();
  });
});
