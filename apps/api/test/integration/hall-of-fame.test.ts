import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PRODUCT_DEFAULTS } from "@creator-outdoor/config";
import { CreatorDetailDto, HallOfFameDto, parseContract } from "@creator-outdoor/contracts";
import { getWeeklyPeriod } from "@creator-outdoor/domain";
import {
  createTestDatabase,
  insertBoost,
  insertCategory,
  insertCreator,
  setCreatorModerationStatus,
  type TestDatabase,
} from "@creator-outdoor/testkit";
import { createApp } from "../../src/app";
import { runWeeklyRollover } from "../../src/services/rollover";

const TZ = PRODUCT_DEFAULTS.timezone;
/** A Wednesday, comfortably inside a weekly period. */
const NOW = new Date("2026-08-19T18:30:00.000Z");

const testDatabase: TestDatabase = await createTestDatabase();
const app = createApp({
  database: testDatabase.db,
  product: PRODUCT_DEFAULTS,
  allowedOrigins: ["http://localhost:3000"],
  adminApiSecret: "integration-admin-secret-value",
  fanIdentitySecret: "um-segredo-de-identidade-de-fa-com-32-bytes",
  now: () => NOW,
});

let categoryId = "";

beforeEach(async () => {
  await testDatabase.truncate();
  const category = await insertCategory(testDatabase.db, {
    slug: "musica",
    name: "Musica",
    isActive: true,
  });
  categoryId = category.id;
});

afterAll(async () => {
  await testDatabase.close();
});

async function call(path: string): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`));
}

/** Wins a past week: a boost inside it, then the rollover that closes it. */
async function championOf(slug: string, weekOffset: number, amountCents: number) {
  const period = getWeeklyPeriod(NOW, TZ, weekOffset);
  const creator = await insertCreator(testDatabase.db, {
    categoryId,
    slug,
    displayName: slug,
    moderationStatus: "APPROVED",
  });
  await insertBoost(testDatabase.db, {
    creatorId: creator.id,
    amountCents,
    confirmedAt: new Date(period.startsAt.getTime() + 3_600_000),
  });
  return creator;
}

async function hallOfFame(query = ""): Promise<HallOfFameDto> {
  const response = await call(`/v1/hall-da-fama${query}`);
  expect(response.status).toBe(200);
  return parseContract(HallOfFameDto, await response.json(), "HallOfFame");
}

async function detail(slug: string): Promise<CreatorDetailDto> {
  return parseContract(
    CreatorDetailDto,
    await (await call(`/v1/creators/${slug}`)).json(),
    "CreatorDetail",
  );
}

describe("the Hall da Fama", () => {
  test("is empty before any week has closed", async () => {
    await championOf("ainda-correndo", 0, 5_000);
    expect(await hallOfFame()).toEqual({ champions: [] });
  });

  test("lists the winner of each closed week, most recent first", async () => {
    await championOf("semana-passada", -1, 5_000);
    await championOf("duas-semanas-atras", -2, 9_000);
    await runWeeklyRollover(testDatabase.db, PRODUCT_DEFAULTS, NOW);

    const hall = await hallOfFame();
    expect(hall.champions.map((champion) => champion.creator.slug)).toEqual([
      "semana-passada",
      "duas-semanas-atras",
    ]);
    expect(hall.champions[0]?.amountCents).toBe(5_000);
  });

  test("names only the winner of a week, not everyone in it", async () => {
    const period = getWeeklyPeriod(NOW, TZ, -1);
    await championOf("venceu", -1, 9_000);
    const second = await insertCreator(testDatabase.db, {
      categoryId,
      slug: "segundo-lugar",
      moderationStatus: "APPROVED",
    });
    await insertBoost(testDatabase.db, {
      creatorId: second.id,
      amountCents: 1_000,
      confirmedAt: new Date(period.startsAt.getTime() + 3_600_000),
    });
    await runWeeklyRollover(testDatabase.db, PRODUCT_DEFAULTS, NOW);

    const hall = await hallOfFame();
    expect(hall.champions.map((champion) => champion.creator.slug)).toEqual(["venceu"]);
  });

  test("drops a champion who stopped being public", async () => {
    const creator = await championOf("saiu-depois", -1, 5_000);
    await runWeeklyRollover(testDatabase.db, PRODUCT_DEFAULTS, NOW);
    expect((await hallOfFame()).champions).toHaveLength(1);

    await setCreatorModerationStatus(testDatabase.db, creator.id, "OPTED_OUT");
    expect((await hallOfFame()).champions).toHaveLength(0);
  });

  test("honours the requested size", async () => {
    await championOf("a", -1, 5_000);
    await championOf("b", -2, 5_000);
    await championOf("c", -3, 5_000);
    await runWeeklyRollover(testDatabase.db, PRODUCT_DEFAULTS, NOW);

    expect((await hallOfFame("?limit=2")).champions).toHaveLength(2);
  });

  test("refuses a size outside the allowed range", async () => {
    expect((await call("/v1/hall-da-fama?limit=0")).status).toBe(400);
    expect((await call("/v1/hall-da-fama?limit=101")).status).toBe(400);
  });
});

describe("the champion badge", () => {
  test("counts nothing before a week has closed", async () => {
    await championOf("novata", 0, 5_000);
    expect((await detail("novata")).championWeeks).toBe(0);
  });

  test("counts each closed week a creator finished on top", async () => {
    const creator = await championOf("bicampea", -1, 5_000);
    const older = getWeeklyPeriod(NOW, TZ, -2);
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 7_000,
      confirmedAt: new Date(older.startsAt.getTime() + 3_600_000),
    });
    await runWeeklyRollover(testDatabase.db, PRODUCT_DEFAULTS, NOW);

    expect((await detail("bicampea")).championWeeks).toBe(2);
  });

  test("counts nothing for a creator who never won", async () => {
    await championOf("venceu-mesmo", -1, 9_000);
    const period = getWeeklyPeriod(NOW, TZ, -1);
    const loser = await insertCreator(testDatabase.db, {
      categoryId,
      slug: "quase",
      moderationStatus: "APPROVED",
    });
    await insertBoost(testDatabase.db, {
      creatorId: loser.id,
      amountCents: 1_000,
      confirmedAt: new Date(period.startsAt.getTime() + 3_600_000),
    });
    await runWeeklyRollover(testDatabase.db, PRODUCT_DEFAULTS, NOW);

    expect((await detail("quase")).championWeeks).toBe(0);
  });
});

describe("the embeddable badge", () => {
  test("renders an SVG carrying the position and the money", async () => {
    const creator = await insertCreator(testDatabase.db, {
      categoryId,
      slug: "luna-verso",
      displayName: "Luna Verso",
      moderationStatus: "APPROVED",
    });
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 12_300,
      confirmedAt: NOW,
    });

    const response = await call("/v1/creators/luna-verso/badge.svg");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    const svg = await response.text();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Luna Verso");
    expect(svg).toContain("#1 desta semana");
    expect(svg).toContain("R$123");
  });

  test("says plainly when a creator has no boosts this week", async () => {
    await insertCreator(testDatabase.db, {
      categoryId,
      slug: "sem-impulsos",
      displayName: "Sem Impulsos",
      moderationStatus: "APPROVED",
    });
    const svg = await (await call("/v1/creators/sem-impulsos/badge.svg")).text();
    expect(svg).toContain("sem impulsos");
  });

  test("escapes a display name rather than letting it become markup", async () => {
    // The badge is served into other people's websites.
    await insertCreator(testDatabase.db, {
      categoryId,
      slug: "perigosa",
      displayName: '<script>alert("x")</script>',
      moderationStatus: "APPROVED",
    });
    const svg = await (await call("/v1/creators/perigosa/badge.svg")).text();
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  test("may be embedded anywhere and is cacheable", async () => {
    await insertCreator(testDatabase.db, {
      categoryId,
      slug: "embutivel",
      moderationStatus: "APPROVED",
    });
    const response = await call("/v1/creators/embutivel/badge.svg");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toContain("max-age=");
  });

  test("is not served for a creator who is not public", async () => {
    const creator = await insertCreator(testDatabase.db, {
      categoryId,
      slug: "removida",
      moderationStatus: "APPROVED",
    });
    await setCreatorModerationStatus(testDatabase.db, creator.id, "REMOVED");
    expect((await call("/v1/creators/removida/badge.svg")).status).toBe(404);
  });

  test("counts an embed impression when the viewer has a session", async () => {
    const creator = await insertCreator(testDatabase.db, {
      categoryId,
      slug: "medida",
      moderationStatus: "APPROVED",
    });
    expect(creator.slug).toBe("medida");

    await app.handle(
      new Request("http://localhost/v1/creators/medida/badge.svg", {
        headers: { "x-analytics-session": "sessao-de-quem-embutiu" },
      }),
    );

    const delivery = (await (
      await call("/v1/creators/medida/delivery?window=all-time")
    ).json()) as { bySurface: Array<{ surface: string; impressions: number }> };
    expect(delivery.bySurface).toEqual([{ surface: "EMBED", impressions: 1 }]);
  });

  test("still renders for a viewer with no session", async () => {
    await insertCreator(testDatabase.db, {
      categoryId,
      slug: "anonima",
      moderationStatus: "APPROVED",
    });
    const response = await call("/v1/creators/anonima/badge.svg");
    expect(response.status).toBe(200);
    expect((await response.text()).startsWith("<svg")).toBe(true);
  });
});
