import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PRODUCT_DEFAULTS } from "@creator-outdoor/config";
import { parseContract, RotationResponseDto } from "@creator-outdoor/contracts";
import { findLatestChampion, findWeeklyPeriod, listPeriodSnapshots } from "@creator-outdoor/db";
import { centsValue, getWeeklyPeriod, moneyCents } from "@creator-outdoor/domain";
import {
  createTestDatabase,
  insertBoost,
  insertCategory,
  insertCreator,
  rawSql,
  refundBoost,
  type TestDatabase,
} from "@creator-outdoor/testkit";
import { createApp } from "../../src/app";
import { runWeeklyRollover, snapshotPeriod } from "../../src/services/rollover";

const TZ = PRODUCT_DEFAULTS.timezone;
/** A Wednesday, comfortably inside a weekly period. */
const NOW = new Date("2026-08-19T18:30:00.000Z");
const PERIOD = getWeeklyPeriod(NOW, TZ);
const PREVIOUS = getWeeklyPeriod(NOW, TZ, -1);
const ZERO = moneyCents(0);

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
    name: "Música",
    isActive: true,
  });
  categoryId = category.id;
});

afterAll(async () => {
  await testDatabase.close();
});

async function call(path: string) {
  return app.handle(new Request(`http://localhost${path}`));
}

async function creatorWithRotation(slug: string, hoursLeft: number, amountCents = 5_000) {
  const creator = await insertCreator(testDatabase.db, {
    categoryId,
    slug,
    moderationStatus: "APPROVED",
  });
  const ids = await insertBoost(testDatabase.db, {
    creatorId: creator.id,
    amountCents,
    confirmedAt: NOW,
  });
  await testDatabase.db.execute(
    rawSql(`update boosts set rotation_starts_at = '${NOW.toISOString()}',
       rotation_ends_at = '${new Date(NOW.getTime() + hoursLeft * 3_600_000).toISOString()}'
     where id = '${ids.boostId}'`),
  );
  return { creator, ids };
}

describe("rotation", () => {
  test("includes only creators whose entitlement is still running", async () => {
    await creatorWithRotation("ativo", 5);
    await creatorWithRotation("expirado", -1);

    const rotation = parseContract(
      RotationResponseDto,
      await (await call("/v1/rotation")).json(),
      "RotationResponse",
    );
    expect(rotation.entries.map((entry) => entry.creator.slug)).toEqual(["ativo"]);
    expect(rotation.eligibleCount).toBe(1);
  });

  test("shows one entry per creator no matter how many boosts they hold", async () => {
    const { creator } = await creatorWithRotation("multiplo", 5);
    for (let extra = 0; extra < 4; extra += 1) {
      const ids = await insertBoost(testDatabase.db, {
        creatorId: creator.id,
        amountCents: 1_000,
        confirmedAt: NOW,
      });
      await testDatabase.db.execute(
        rawSql(`update boosts set rotation_ends_at = '${new Date(NOW.getTime() + 3_600_000).toISOString()}'
         where id = '${ids.boostId}'`),
      );
    }

    const rotation = parseContract(
      RotationResponseDto,
      await (await call("/v1/rotation")).json(),
      "RotationResponse",
    );
    expect(rotation.entries).toHaveLength(1);
    // The longest entitlement decides, not the newest boost.
    expect(new Date(rotation.entries[0]?.rotationEndsAt ?? 0).toISOString()).toBe(
      new Date(NOW.getTime() + 5 * 3_600_000).toISOString(),
    );
  });

  test("excludes a creator who stopped being publicly eligible", async () => {
    const { creator } = await creatorWithRotation("removido", 5);
    await testDatabase.db.execute(
      rawSql(`update creators set moderation_status = 'REMOVED' where id = '${creator.id}'`),
    );
    const rotation = parseContract(
      RotationResponseDto,
      await (await call("/v1/rotation")).json(),
      "RotationResponse",
    );
    expect(rotation.entries).toHaveLength(0);
  });

  test("does not favour the biggest spender", async () => {
    // If selection were ordered by amount, the R$1000 creator would always be
    // first. It must not be.
    await creatorWithRotation("modesto", 10, 500);
    await creatorWithRotation("generoso", 10, 100_000);
    const rotation = parseContract(
      RotationResponseDto,
      await (await call("/v1/rotation")).json(),
      "RotationResponse",
    );
    expect(rotation.entries).toHaveLength(2);
    expect(rotation.eligibleCount).toBe(2);
  });

  test("caps what it shows while reporting how many are entitled", async () => {
    for (let index = 0; index < PRODUCT_DEFAULTS.rotationFeedMax + 5; index += 1) {
      await creatorWithRotation(`criador-${String(index).padStart(2, "0")}`, 10);
    }
    const rotation = parseContract(
      RotationResponseDto,
      await (await call("/v1/rotation")).json(),
      "RotationResponse",
    );
    expect(rotation.entries).toHaveLength(PRODUCT_DEFAULTS.rotationFeedMax);
    expect(rotation.eligibleCount).toBe(PRODUCT_DEFAULTS.rotationFeedMax + 5);
  });
});

describe("weekly rollover", () => {
  async function seedPreviousWeek() {
    const winner = await insertCreator(testDatabase.db, {
      categoryId,
      slug: "campeao",
      moderationStatus: "APPROVED",
    });
    const runnerUp = await insertCreator(testDatabase.db, {
      categoryId,
      slug: "vice",
      moderationStatus: "APPROVED",
    });
    const confirmedAt = new Date(PREVIOUS.startsAt.getTime() + 3_600_000);
    const winnerBoost = await insertBoost(testDatabase.db, {
      creatorId: winner.id,
      amountCents: 50_000,
      confirmedAt,
    });
    await insertBoost(testDatabase.db, {
      creatorId: runnerUp.id,
      amountCents: 20_000,
      confirmedAt,
    });
    return { winner, runnerUp, winnerBoost, confirmedAt };
  }

  test("snapshots the closed period and names a champion", async () => {
    await seedPreviousWeek();
    const summary = await runWeeklyRollover(testDatabase.db, PRODUCT_DEFAULTS, NOW);
    expect(summary.closedPeriods).toBeGreaterThanOrEqual(1);

    const champion = await findLatestChampion(testDatabase.db);
    expect(champion?.slug).toBe("campeao");
    expect(centsValue(champion?.amountCents ?? ZERO)).toBe(50_000);
  });

  test("is safe to run repeatedly", async () => {
    await seedPreviousWeek();
    await runWeeklyRollover(testDatabase.db, PRODUCT_DEFAULTS, NOW);
    await runWeeklyRollover(testDatabase.db, PRODUCT_DEFAULTS, NOW);
    await runWeeklyRollover(testDatabase.db, PRODUCT_DEFAULTS, NOW);

    const period = await findWeeklyPeriod(testDatabase.db, PREVIOUS);
    expect(period?.status).toBe("CLOSED");
    const snapshots = await listPeriodSnapshots(testDatabase.db, period?.id ?? "", 100);
    // Two creators, two snapshots — never six.
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((row) => row.rank)).toEqual([1, 2]);
  });

  test("is safe to run concurrently", async () => {
    await seedPreviousWeek();
    await Promise.all(
      Array.from({ length: 4 }, () => runWeeklyRollover(testDatabase.db, PRODUCT_DEFAULTS, NOW)),
    );
    const period = await findWeeklyPeriod(testDatabase.db, PREVIOUS);
    const snapshots = await listPeriodSnapshots(testDatabase.db, period?.id ?? "", 100);
    expect(snapshots).toHaveLength(2);
  });

  test("produces the same ranking whenever it happens to run", async () => {
    await seedPreviousWeek();
    // Seven minutes after midnight, and again half a day later.
    const justAfterMidnight = new Date(PERIOD.startsAt.getTime() + 7 * 60_000);
    await runWeeklyRollover(testDatabase.db, PRODUCT_DEFAULTS, justAfterMidnight);
    const period = await findWeeklyPeriod(testDatabase.db, PREVIOUS);
    const early = await listPeriodSnapshots(testDatabase.db, period?.id ?? "", 100);

    await runWeeklyRollover(testDatabase.db, PRODUCT_DEFAULTS, NOW);
    const late = await listPeriodSnapshots(testDatabase.db, period?.id ?? "", 100);

    expect(late.map((row) => [row.creatorSlug, row.rank, row.amountCents])).toEqual(
      early.map((row) => [row.creatorSlug, row.rank, row.amountCents]),
    );
  });

  test("closes several missed weeks rather than only the last one", async () => {
    const creator = await insertCreator(testDatabase.db, {
      categoryId,
      slug: "constante",
      moderationStatus: "APPROVED",
    });
    for (let week = 1; week <= 3; week += 1) {
      const period = getWeeklyPeriod(NOW, TZ, -week);
      await insertBoost(testDatabase.db, {
        creatorId: creator.id,
        amountCents: 1_000 * week,
        confirmedAt: new Date(period.startsAt.getTime() + 3_600_000),
      });
    }

    const summary = await runWeeklyRollover(testDatabase.db, PRODUCT_DEFAULTS, NOW);
    expect(summary.closedPeriods).toBeGreaterThanOrEqual(3);

    for (let week = 1; week <= 3; week += 1) {
      const period = await findWeeklyPeriod(testDatabase.db, getWeeklyPeriod(NOW, TZ, -week));
      expect(period?.status, `week -${week}`).toBe("CLOSED");
    }
  });
});

describe("a refund landing after the period closed", () => {
  test("corrects the snapshots and can change who the champion was", async () => {
    const winner = await insertCreator(testDatabase.db, {
      categoryId,
      slug: "campeao-temporario",
      moderationStatus: "APPROVED",
    });
    const runnerUp = await insertCreator(testDatabase.db, {
      categoryId,
      slug: "campeao-real",
      moderationStatus: "APPROVED",
    });
    const confirmedAt = new Date(PREVIOUS.startsAt.getTime() + 3_600_000);
    const refunded = await insertBoost(testDatabase.db, {
      creatorId: winner.id,
      amountCents: 50_000,
      confirmedAt,
    });
    await insertBoost(testDatabase.db, {
      creatorId: runnerUp.id,
      amountCents: 20_000,
      confirmedAt,
    });

    await runWeeklyRollover(testDatabase.db, PRODUCT_DEFAULTS, NOW);
    expect((await findLatestChampion(testDatabase.db))?.slug).toBe("campeao-temporario");

    // Weeks later, the money goes back.
    await refundBoost(testDatabase.db, refunded, NOW);
    await snapshotPeriod(testDatabase.db, PREVIOUS, {
      close: true,
      now: NOW,
      actor: "system:refund-correction",
    });

    const champion = await findLatestChampion(testDatabase.db);
    expect(champion?.slug).toBe("campeao-real");

    // The refunded creator is gone from the period entirely, not left at rank 2
    // with money that no longer exists.
    const period = await findWeeklyPeriod(testDatabase.db, PREVIOUS);
    const snapshots = await listPeriodSnapshots(testDatabase.db, period?.id ?? "", 100);
    expect(snapshots.map((row) => row.creatorSlug)).toEqual(["campeao-real"]);
  });
});

describe("the overtake ticker", () => {
  test("is empty before anything happens", async () => {
    const response = await call("/v1/rank-events");
    expect(await response.json()).toEqual({ events: [] });
  });
});
