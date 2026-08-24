import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PRODUCT_DEFAULTS } from "@creator-outdoor/config";
import { LeaderboardResponseDto, parseContract } from "@creator-outdoor/contracts";
import { centsValue, getWeeklyPeriod, MODERATION_STATUSES } from "@creator-outdoor/domain";
import {
  createTestDatabase,
  findPrimaryLinkId,
  insertBoost,
  insertCategory,
  insertCreator,
  insertImpression,
  insertOutboundClick,
  readWholeLeaderboard,
  refundBoost,
  setCreatorModerationStatus,
  type TestDatabase,
} from "@creator-outdoor/testkit";
import { createApp } from "../../src/app";

const TZ = PRODUCT_DEFAULTS.timezone;
/** A Wednesday, comfortably inside a weekly period. */
const NOW = new Date("2026-08-19T18:30:00.000Z");
const PERIOD = getWeeklyPeriod(NOW, TZ);
const WINDOW = { startsAt: PERIOD.startsAt, endsAt: PERIOD.endsAt };

const testDatabase: TestDatabase = await createTestDatabase();
const app = createApp({
  database: testDatabase.db,
  product: PRODUCT_DEFAULTS,
  allowedOrigins: ["http://localhost:3000"],
  now: () => NOW,
});

async function seedCategory(slug = "musica") {
  return insertCategory(testDatabase.db, { slug, name: "Música", isActive: true });
}

beforeEach(async () => {
  await testDatabase.truncate();
});

afterAll(async () => {
  await testDatabase.close();
});

async function fetchJson(path: string): Promise<unknown> {
  const response = await app.handle(new Request(`http://localhost${path}`));
  return response.json();
}

describe("weekly score aggregation", () => {
  test("a confirmed ACTIVE boost increases the weekly score", async () => {
    const category = await seedCategory();
    const creator = await insertCreator(testDatabase.db, { categoryId: category.id });
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 5_000,
      confirmedAt: NOW,
    });
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 2_500,
      confirmedAt: NOW,
    });

    const page = await readWholeLeaderboard(testDatabase.db, WINDOW);
    expect(page.entries).toHaveLength(1);
    expect(page.entries.map((entry) => centsValue(entry.amountCents))).toEqual([7_500]);
  });

  test("a confirmed ACTIVE boost increases the all-time score", async () => {
    const category = await seedCategory();
    const creator = await insertCreator(testDatabase.db, { categoryId: category.id });
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 5_000,
      confirmedAt: NOW,
    });
    // Confirmed eleven weeks ago: outside the weekly window, inside all-time.
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 9_900,
      confirmedAt: new Date("2026-06-03T12:00:00.000Z"),
    });

    const weekly = await readWholeLeaderboard(testDatabase.db, WINDOW);
    const allTime = await readWholeLeaderboard(testDatabase.db, null);
    expect(weekly.entries.map((entry) => centsValue(entry.amountCents))).toEqual([5_000]);
    expect(allTime.entries.map((entry) => centsValue(entry.amountCents))).toEqual([14_900]);
  });

  test("the all-time ranking includes historical active boosts", async () => {
    const category = await seedCategory();
    const historical = await insertCreator(testDatabase.db, {
      categoryId: category.id,
      slug: "historico",
    });
    const recent = await insertCreator(testDatabase.db, {
      categoryId: category.id,
      slug: "recente",
    });
    await insertBoost(testDatabase.db, {
      creatorId: historical.id,
      amountCents: 50_000,
      confirmedAt: new Date("2026-02-10T12:00:00.000Z"),
    });
    await insertBoost(testDatabase.db, {
      creatorId: recent.id,
      amountCents: 10_000,
      confirmedAt: NOW,
    });

    const weekly = await readWholeLeaderboard(testDatabase.db, WINDOW);
    const allTime = await readWholeLeaderboard(testDatabase.db, null);
    expect(weekly.entries.map((entry) => entry.creatorSlug)).toEqual(["recente"]);
    expect(allTime.entries.map((entry) => entry.creatorSlug)).toEqual(["historico", "recente"]);
  });
});

describe("ranking exclusions", () => {
  test("an unsettled, failed or reversed payment never ranks", async () => {
    const category = await seedCategory();
    const creator = await insertCreator(testDatabase.db, { categoryId: category.id });
    for (const paymentStatus of [
      "CREATED",
      "PENDING",
      "FAILED",
      "EXPIRED",
      "CANCELLED",
      "REFUNDED",
    ] as const) {
      await insertBoost(testDatabase.db, {
        creatorId: creator.id,
        amountCents: 10_000,
        confirmedAt: NOW,
        paymentStatus,
        boostStatus: paymentStatus === "REFUNDED" ? "REVERSED" : "PENDING",
      });
    }

    const page = await readWholeLeaderboard(testDatabase.db, WINDOW);
    expect(page.entries).toHaveLength(0);
    expect(page.leader).toBeNull();
    expect(page.total).toBe(0);
  });

  test("a confirmed payment behind a non-active boost never ranks", async () => {
    const category = await seedCategory();
    const creator = await insertCreator(testDatabase.db, { categoryId: category.id });
    for (const boostStatus of ["PENDING", "VOID", "REVERSED"] as const) {
      await insertBoost(testDatabase.db, {
        creatorId: creator.id,
        amountCents: 10_000,
        confirmedAt: NOW,
        boostStatus,
      });
    }
    const page = await readWholeLeaderboard(testDatabase.db, WINDOW);
    expect(page.entries).toHaveLength(0);
  });

  test("a boost confirmed outside the window does not count toward the week", async () => {
    const category = await seedCategory();
    const creator = await insertCreator(testDatabase.db, { categoryId: category.id });
    // One millisecond before the period opened, and exactly when it closes.
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 10_000,
      confirmedAt: new Date(PERIOD.startsAt.getTime() - 1),
    });
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 20_000,
      confirmedAt: PERIOD.endsAt,
    });
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 500,
      confirmedAt: PERIOD.startsAt,
    });

    const page = await readWholeLeaderboard(testDatabase.db, WINDOW);
    expect(page.entries.map((entry) => centsValue(entry.amountCents))).toEqual([500]);
  });
});

describe("public creator eligibility", () => {
  test("only APPROVED creators appear in a ranking", async () => {
    const category = await seedCategory();
    for (const moderationStatus of MODERATION_STATUSES) {
      const creator = await insertCreator(testDatabase.db, {
        categoryId: category.id,
        slug: `criador-${moderationStatus.toLowerCase().replace(/_/g, "-")}`,
        moderationStatus,
      });
      await insertBoost(testDatabase.db, {
        creatorId: creator.id,
        amountCents: 10_000,
        confirmedAt: NOW,
      });
    }

    const page = await readWholeLeaderboard(testDatabase.db, WINDOW);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.creatorSlug).toBe("criador-approved");
  });

  test("money already paid to a creator who became ineligible disappears from the ranking", async () => {
    const category = await seedCategory();
    const creator = await insertCreator(testDatabase.db, { categoryId: category.id });
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 10_000,
      confirmedAt: NOW,
    });
    expect((await readWholeLeaderboard(testDatabase.db, WINDOW)).entries).toHaveLength(1);

    await setCreatorModerationStatus(testDatabase.db, creator.id, "OPTED_OUT");

    const page = await readWholeLeaderboard(testDatabase.db, WINDOW);
    expect(page.entries).toHaveLength(0);
  });
});

describe("ranking order", () => {
  test("orders by score, then by who reached it first, then by who joined first", async () => {
    const category = await seedCategory();
    const rich = await insertCreator(testDatabase.db, { categoryId: category.id, slug: "rico" });
    const early = await insertCreator(testDatabase.db, {
      categoryId: category.id,
      slug: "cedo",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const late = await insertCreator(testDatabase.db, {
      categoryId: category.id,
      slug: "tarde",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    await insertBoost(testDatabase.db, {
      creatorId: rich.id,
      amountCents: 20_000,
      confirmedAt: NOW,
    });
    await insertBoost(testDatabase.db, {
      creatorId: early.id,
      amountCents: 10_000,
      confirmedAt: new Date("2026-08-18T10:00:00.000Z"),
    });
    await insertBoost(testDatabase.db, {
      creatorId: late.id,
      amountCents: 10_000,
      confirmedAt: new Date("2026-08-18T11:00:00.000Z"),
    });

    const page = await readWholeLeaderboard(testDatabase.db, WINDOW);
    expect(page.entries.map((entry) => entry.creatorSlug)).toEqual(["rico", "cedo", "tarde"]);
    expect(page.entries.map((entry) => entry.rank)).toEqual([1, 2, 3]);
  });

  test("a final tie falls back to creator.createdAt", async () => {
    const category = await seedCategory();
    const older = await insertCreator(testDatabase.db, {
      categoryId: category.id,
      slug: "antigo",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const newer = await insertCreator(testDatabase.db, {
      categoryId: category.id,
      slug: "novo",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    const sameInstant = new Date("2026-08-18T10:00:00.000Z");
    await insertBoost(testDatabase.db, {
      creatorId: newer.id,
      amountCents: 10_000,
      confirmedAt: sameInstant,
    });
    await insertBoost(testDatabase.db, {
      creatorId: older.id,
      amountCents: 10_000,
      confirmedAt: sameInstant,
    });

    const page = await readWholeLeaderboard(testDatabase.db, WINDOW);
    expect(page.entries.map((entry) => entry.creatorSlug)).toEqual(["antigo", "novo"]);
  });

  test("the tie-break timestamp is the latest confirmation still counted", async () => {
    const category = await seedCategory();
    const creator = await insertCreator(testDatabase.db, { categoryId: category.id });
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 5_000,
      confirmedAt: new Date("2026-08-18T10:00:00.000Z"),
    });
    const later = await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 5_000,
      confirmedAt: new Date("2026-08-18T11:00:00.000Z"),
    });

    const before = await readWholeLeaderboard(testDatabase.db, WINDOW);
    expect(before.entries.map((entry) => centsValue(entry.amountCents))).toEqual([10_000]);
    expect(before.entries[0]?.reachedCurrentScoreAt?.toISOString()).toBe(
      "2026-08-18T11:00:00.000Z",
    );

    // The later boost is refunded: the score and the timestamp both fall back,
    // and the refund time is not treated as when the lower score was reached.
    await refundBoost(testDatabase.db, later, NOW);

    const after = await readWholeLeaderboard(testDatabase.db, WINDOW);
    expect(after.entries.map((entry) => centsValue(entry.amountCents))).toEqual([5_000]);
    expect(after.entries[0]?.reachedCurrentScoreAt?.toISOString()).toBe("2026-08-18T10:00:00.000Z");
  });

  test("a refund drops a creator down the ranking", async () => {
    const category = await seedCategory();
    const subject = await insertCreator(testDatabase.db, {
      categoryId: category.id,
      slug: "assunto",
    });
    const rival = await insertCreator(testDatabase.db, { categoryId: category.id, slug: "rival" });
    const refunded = await insertBoost(testDatabase.db, {
      creatorId: subject.id,
      amountCents: 20_000,
      confirmedAt: NOW,
    });
    await insertBoost(testDatabase.db, {
      creatorId: rival.id,
      amountCents: 15_000,
      confirmedAt: NOW,
    });
    expect((await readWholeLeaderboard(testDatabase.db, WINDOW)).leader?.creatorSlug).toBe(
      "assunto",
    );

    await refundBoost(testDatabase.db, refunded, NOW);

    const page = await readWholeLeaderboard(testDatabase.db, WINDOW);
    expect(page.leader?.creatorSlug).toBe("rival");
    expect(page.entries.map((entry) => entry.creatorSlug)).toEqual(["rival"]);
  });
});

describe("supporter counting", () => {
  test("counts distinct fan identities, never display names", async () => {
    const category = await seedCategory();
    const creator = await insertCreator(testDatabase.db, { categoryId: category.id });
    // The same person boosting twice is one supporter.
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 1_000,
      confirmedAt: NOW,
      fanIdentityKey: "fan-a",
      supporterName: "Marina",
    });
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 1_000,
      confirmedAt: NOW,
      fanIdentityKey: "fan-a",
      supporterName: "Marina",
    });
    // A different person who happens to share the display name is not merged.
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 1_000,
      confirmedAt: NOW,
      fanIdentityKey: "fan-b",
      supporterName: "Marina",
    });
    // An anonymous boost counts toward the creator's score and supporter count.
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 1_000,
      confirmedAt: NOW,
      anonymous: true,
    });

    const page = await readWholeLeaderboard(testDatabase.db, WINDOW);
    expect(page.entries.map((entry) => centsValue(entry.amountCents))).toEqual([4_000]);
    expect(page.entries[0]?.supporterCount).toBe(3);
  });
});

describe("analytics never influence a ranking", () => {
  test("impressions and outbound clicks do not change the order or the score", async () => {
    const category = await seedCategory();
    const leader = await insertCreator(testDatabase.db, { categoryId: category.id, slug: "lider" });
    const popular = await insertCreator(testDatabase.db, {
      categoryId: category.id,
      slug: "popular",
    });
    await insertBoost(testDatabase.db, {
      creatorId: leader.id,
      amountCents: 10_000,
      confirmedAt: NOW,
    });
    await insertBoost(testDatabase.db, {
      creatorId: popular.id,
      amountCents: 5_000,
      confirmedAt: NOW,
    });
    const linkId = await findPrimaryLinkId(testDatabase.db, popular.id);

    const before = await readWholeLeaderboard(testDatabase.db, WINDOW);

    for (let index = 0; index < 25; index += 1) {
      await insertImpression(testDatabase.db, {
        creatorId: popular.id,
        sessionId: `sid-${index}`,
      });
      await insertOutboundClick(testDatabase.db, {
        creatorId: popular.id,
        creatorLinkId: linkId,
        sessionId: `sid-${index}`,
      });
    }

    const after = await readWholeLeaderboard(testDatabase.db, WINDOW);
    expect(
      after.entries.map((entry) => [entry.creatorSlug, entry.amountCents, entry.rank]),
    ).toEqual(before.entries.map((entry) => [entry.creatorSlug, entry.amountCents, entry.rank]));
    expect(after.leader?.creatorSlug).toBe("lider");
  });
});

describe("categories", () => {
  test("a category ranking ranks within the category", async () => {
    const musica = await seedCategory("musica");
    const games = await insertCategory(testDatabase.db, {
      slug: "games",
      name: "Games",
      isActive: false,
    });
    const musician = await insertCreator(testDatabase.db, {
      categoryId: musica.id,
      slug: "musico",
    });
    const gamer = await insertCreator(testDatabase.db, { categoryId: games.id, slug: "gamer" });
    await insertBoost(testDatabase.db, {
      creatorId: musician.id,
      amountCents: 5_000,
      confirmedAt: NOW,
    });
    await insertBoost(testDatabase.db, {
      creatorId: gamer.id,
      amountCents: 50_000,
      confirmedAt: NOW,
    });

    const global = await readWholeLeaderboard(testDatabase.db, WINDOW);
    expect(global.entries.map((entry) => entry.creatorSlug)).toEqual(["gamer", "musico"]);

    const inCategory = await readWholeLeaderboard(testDatabase.db, WINDOW, "musica");
    expect(inCategory.entries.map((entry) => entry.creatorSlug)).toEqual(["musico"]);
    expect(inCategory.entries[0]?.rank).toBe(1);
    expect(inCategory.total).toBe(1);
  });
});

describe("pagination", () => {
  test("keeps ranks absolute and always resolves the leader", async () => {
    const category = await seedCategory();
    for (let index = 0; index < 6; index += 1) {
      const creator = await insertCreator(testDatabase.db, {
        categoryId: category.id,
        slug: `criador-${index}`,
      });
      await insertBoost(testDatabase.db, {
        creatorId: creator.id,
        amountCents: 10_000 - index * 1_000,
        confirmedAt: NOW,
      });
    }

    const secondPage = await readWholeLeaderboard(testDatabase.db, WINDOW);
    expect(secondPage.total).toBe(6);

    const response = await fetchJson("/v1/rankings/weekly?limit=2&offset=2");
    const payload = parseContract(LeaderboardResponseDto, response, "LeaderboardResponse");
    expect(payload.entries.map((entry) => entry.rank)).toEqual([3, 4]);
    expect(payload.leader?.rank).toBe(1);
    expect(payload.leader?.creator.slug).toBe("criador-0");
    expect(payload.total).toBe(6);
  });
});

describe("the weekly window is derived from the instant", () => {
  function appAt(instant: Date) {
    return createApp({
      database: testDatabase.db,
      product: PRODUCT_DEFAULTS,
      allowedOrigins: ["http://localhost:3000"],
      now: () => instant,
    });
  }

  async function weeklyAt(instant: Date) {
    const response = await appAt(instant).handle(
      new Request("http://localhost/v1/rankings/weekly"),
    );
    return parseContract(LeaderboardResponseDto, await response.json(), "LeaderboardResponse");
  }

  test("the period boundary is São Paulo local midnight, not UTC midnight", async () => {
    const payload = await weeklyAt(NOW);
    expect(payload.period).toEqual({
      type: "WEEKLY",
      startsAt: "2026-08-17T03:00:00.000Z",
      endsAt: "2026-08-24T03:00:00.000Z",
    });
  });

  test("the ranking does not depend on when a rollover job ran", async () => {
    const category = await seedCategory();
    const creator = await insertCreator(testDatabase.db, { categoryId: category.id });
    // Confirmed seven minutes after the new week opened.
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 10_000,
      confirmedAt: new Date("2026-08-17T03:07:00.000Z"),
    });

    const atMidnight = await weeklyAt(new Date("2026-08-17T03:00:30.000Z"));
    const hoursLater = await weeklyAt(new Date("2026-08-17T14:00:00.000Z"));
    const daysLater = await weeklyAt(NOW);

    expect(atMidnight.period).toEqual(daysLater.period);
    expect(hoursLater.period).toEqual(daysLater.period);
    expect(daysLater.entries[0]?.amountCents).toBe(10_000);
    // The same boost belongs to the previous period when read from before it.
    const previousWeek = await weeklyAt(new Date("2026-08-16T12:00:00.000Z"));
    expect(previousWeek.entries).toHaveLength(0);
  });

  test("the all-time ranking carries no period boundaries", async () => {
    const response = await app.handle(new Request("http://localhost/v1/rankings/all-time"));
    const payload = parseContract(
      LeaderboardResponseDto,
      await response.json(),
      "LeaderboardResponse",
    );
    expect(payload.period).toEqual({ type: "ALL_TIME" });
  });
});

describe("HTTP surface", () => {
  test("reports health", async () => {
    const response = await app.handle(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("rejects an out-of-range query instead of trusting the caller", async () => {
    for (const query of ["limit=0", "limit=101", "offset=-1", "limit=abc", "category=NÃO VÁLIDO"]) {
      const response = await app.handle(
        new Request(`http://localhost/v1/rankings/weekly?${query}`),
      );
      expect(response.status, query).toBe(400);
    }
  });

  test("answers CORS for the configured origin and not for a stranger", async () => {
    const allowed = await app.handle(
      new Request("http://localhost/v1/rankings/weekly", {
        headers: { origin: "http://localhost:3000" },
      }),
    );
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");

    const stranger = await app.handle(
      new Request("http://localhost/v1/rankings/weekly", {
        headers: { origin: "https://exemplo-malicioso.com" },
      }),
    );
    expect(stranger.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(stranger.headers.get("access-control-allow-origin")).not.toBe(
      "https://exemplo-malicioso.com",
    );
  });

  test("never exposes a private field over HTTP", async () => {
    const category = await seedCategory();
    const creator = await insertCreator(testDatabase.db, { categoryId: category.id });
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 5_000,
      confirmedAt: NOW,
      supporterEmail: "fa@exemplo.com",
      fanIdentityKey: "chave-privada-do-fa",
      supporterName: "Marina",
    });

    const body = await (
      await app.handle(new Request("http://localhost/v1/rankings/weekly"))
    ).text();
    for (const secret of [
      "fa@exemplo.com",
      "chave-privada-do-fa",
      "fanIdentityKey",
      "supporterEmail",
      "providerPaymentId",
      "test_payment",
      "moderationStatus",
    ]) {
      expect(body.includes(secret), secret).toBe(false);
    }
  });
});
