import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PRODUCT_DEFAULTS } from "@creator-outdoor/config";
import { parseContract, TorcidaDto } from "@creator-outdoor/contracts";
import { getWeeklyPeriod } from "@creator-outdoor/domain";
import {
  createTestDatabase,
  insertBoost,
  insertCategory,
  insertCreator,
  refundBoost,
  setCreatorModerationStatus,
  type TestDatabase,
} from "@creator-outdoor/testkit";
import { createApp } from "../../src/app";

/** A Wednesday, comfortably inside a weekly period. */
const NOW = new Date("2026-08-19T18:30:00.000Z");
const LAST_WEEK = new Date(
  getWeeklyPeriod(NOW, PRODUCT_DEFAULTS.timezone, -1).startsAt.getTime() + 3_600_000,
);

const testDatabase: TestDatabase = await createTestDatabase();
const app = createApp({
  database: testDatabase.db,
  product: PRODUCT_DEFAULTS,
  allowedOrigins: ["http://localhost:3000"],
  adminApiSecret: "integration-admin-secret-value",
  fanIdentitySecret: "um-segredo-de-identidade-de-fa-com-32-bytes",
  now: () => NOW,
});

let creatorId = "";

beforeEach(async () => {
  await testDatabase.truncate();
  const category = await insertCategory(testDatabase.db, {
    slug: "musica",
    name: "Música",
    isActive: true,
  });
  const creator = await insertCreator(testDatabase.db, {
    categoryId: category.id,
    slug: "luna-verso",
    displayName: "Luna Verso",
    moderationStatus: "APPROVED",
  });
  creatorId = creator.id;
});

afterAll(async () => {
  await testDatabase.close();
});

async function torcida(query = ""): Promise<TorcidaDto> {
  const response = await app.handle(
    new Request(`http://localhost/v1/creators/luna-verso/torcida${query}`),
  );
  expect(response.status).toBe(200);
  return parseContract(TorcidaDto, await response.json(), "Torcida");
}

describe("the supporter wall", () => {
  test("is empty for a creator nobody has boosted", async () => {
    const wall = await torcida();
    expect(wall).toEqual({
      creatorSlug: "luna-verso",
      window: "weekly",
      entries: [],
      supporterCount: 0,
      totalAmountCents: 0,
      total: 0,
    });
  });

  test("shows supporters ordered by money, highest first", async () => {
    await insertBoost(testDatabase.db, {
      creatorId,
      amountCents: 1_000,
      confirmedAt: NOW,
      supporterName: "Bia",
      fanIdentityKey: "fan-bia",
    });
    await insertBoost(testDatabase.db, {
      creatorId,
      amountCents: 5_000,
      confirmedAt: NOW,
      supporterName: "Ana",
      fanIdentityKey: "fan-ana",
    });

    const wall = await torcida();
    expect(wall.entries.map((entry) => entry.supporterName)).toEqual(["Ana", "Bia"]);
    expect(wall.entries.map((entry) => entry.amountCents)).toEqual([5_000, 1_000]);
    expect(wall.supporterCount).toBe(2);
    expect(wall.totalAmountCents).toBe(6_000);
    expect(wall.total).toBe(2);
  });

  test("counts one supporter once however many times they boost", async () => {
    for (const amountCents of [1_000, 2_000, 3_000]) {
      await insertBoost(testDatabase.db, {
        creatorId,
        amountCents,
        confirmedAt: NOW,
        supporterName: "Ana",
        fanIdentityKey: "fan-ana",
      });
    }

    const wall = await torcida();
    expect(wall.entries).toHaveLength(1);
    expect(wall.entries[0]?.amountCents).toBe(6_000);
    expect(wall.entries[0]?.boostCount).toBe(3);
    expect(wall.supporterCount).toBe(1);
  });

  test("keeps a name the supporter chose once, even if a later boost omits it", async () => {
    await insertBoost(testDatabase.db, {
      creatorId,
      amountCents: 1_000,
      confirmedAt: new Date(NOW.getTime() - 3_600_000),
      supporterName: "Ana",
      supporterMessage: "vamos!",
      fanIdentityKey: "fan-ana",
    });
    await insertBoost(testDatabase.db, {
      creatorId,
      amountCents: 2_000,
      confirmedAt: NOW,
      fanIdentityKey: "fan-ana",
    });

    const wall = await torcida();
    expect(wall.entries[0]?.supporterName).toBe("Ana");
    expect(wall.entries[0]?.message).toBe("vamos!");
  });

  test("two people who never identified themselves stay two entries", async () => {
    // Without a fan identity key each boost stands alone; folding them together
    // would merge strangers into one supporter.
    await insertBoost(testDatabase.db, { creatorId, amountCents: 1_000, confirmedAt: NOW });
    await insertBoost(testDatabase.db, { creatorId, amountCents: 2_000, confirmedAt: NOW });

    const wall = await torcida();
    expect(wall.entries).toHaveLength(2);
    expect(wall.supporterCount).toBe(2);
  });
});

describe("what the wall refuses to publish", () => {
  test("shows no name for an anonymous supporter", async () => {
    await insertBoost(testDatabase.db, {
      creatorId,
      amountCents: 5_000,
      confirmedAt: NOW,
      anonymous: true,
      supporterName: "Ana",
      fanIdentityKey: "fan-ana",
    });

    const wall = await torcida();
    expect(wall.entries[0]?.anonymous).toBe(true);
    expect(wall.entries[0]?.supporterName).toBeNull();
  });

  test("never attributes an anonymous boost to the same person's named one", async () => {
    // The whole point of the anonymous option: this amount must not appear
    // under Ana's name, even though the platform knows both boosts are hers.
    await insertBoost(testDatabase.db, {
      creatorId,
      amountCents: 1_000,
      confirmedAt: NOW,
      supporterName: "Ana",
      fanIdentityKey: "fan-ana",
    });
    await insertBoost(testDatabase.db, {
      creatorId,
      amountCents: 9_000,
      confirmedAt: NOW,
      anonymous: true,
      fanIdentityKey: "fan-ana",
    });

    const wall = await torcida();
    expect(wall.entries).toHaveLength(2);
    const named = wall.entries.find((entry) => entry.supporterName === "Ana");
    expect(named?.amountCents).toBe(1_000);
    const hidden = wall.entries.find((entry) => entry.anonymous);
    expect(hidden?.amountCents).toBe(9_000);
    expect(hidden?.supporterName).toBeNull();
    // Still one person, counted once, exactly as the ranking counts them.
    expect(wall.supporterCount).toBe(1);
  });

  test("carries no email, identity key or payment identifier", async () => {
    await insertBoost(testDatabase.db, {
      creatorId,
      amountCents: 5_000,
      confirmedAt: NOW,
      supporterName: "Ana",
      supporterEmail: "ana@example.com",
      fanIdentityKey: "fan-ana-secret-key",
    });

    const response = await app.handle(
      new Request("http://localhost/v1/creators/luna-verso/torcida"),
    );
    const body = await response.text();
    for (const secret of [
      "ana@example.com",
      "fan-ana-secret-key",
      "providerPaymentId",
      "paymentId",
    ]) {
      expect(body, secret).not.toContain(secret);
    }
  });

  test("gives a supporter a different id on a different creator's wall", async () => {
    // A wall id that were stable across creators would let anyone follow a
    // supporter from profile to profile.
    const other = await insertCreator(testDatabase.db, {
      categoryId: (await insertCategory(testDatabase.db, { slug: "jogos", name: "Jogos" })).id,
      slug: "outro-perfil",
      moderationStatus: "APPROVED",
    });
    await insertBoost(testDatabase.db, {
      creatorId,
      amountCents: 5_000,
      confirmedAt: NOW,
      supporterName: "Ana",
      fanIdentityKey: "fan-ana",
    });
    await insertBoost(testDatabase.db, {
      creatorId: other.id,
      amountCents: 5_000,
      confirmedAt: NOW,
      supporterName: "Ana",
      fanIdentityKey: "fan-ana",
    });

    const here = await torcida();
    const there = parseContract(
      TorcidaDto,
      await (
        await app.handle(new Request("http://localhost/v1/creators/outro-perfil/torcida"))
      ).json(),
      "Torcida",
    );
    expect(here.entries[0]?.id).not.toBe(there.entries[0]?.id);
  });

  test("answers 404 for a creator who is not public", async () => {
    await setCreatorModerationStatus(testDatabase.db, creatorId, "REMOVED");
    const response = await app.handle(
      new Request("http://localhost/v1/creators/luna-verso/torcida"),
    );
    expect(response.status).toBe(404);
  });
});

describe("the wall follows the money", () => {
  test("drops a refunded boost exactly as the ranking does", async () => {
    const ids = await insertBoost(testDatabase.db, {
      creatorId,
      amountCents: 5_000,
      confirmedAt: NOW,
      supporterName: "Ana",
      fanIdentityKey: "fan-ana",
    });
    expect((await torcida()).entries).toHaveLength(1);

    await refundBoost(testDatabase.db, ids, NOW);

    const wall = await torcida();
    expect(wall.entries).toHaveLength(0);
    expect(wall.supporterCount).toBe(0);
    expect(wall.totalAmountCents).toBe(0);
  });

  test("ignores a boost whose payment never confirmed", async () => {
    await insertBoost(testDatabase.db, {
      creatorId,
      amountCents: 5_000,
      paymentStatus: "PENDING",
      boostStatus: "PENDING",
      supporterName: "Ana",
    });
    expect((await torcida()).entries).toHaveLength(0);
  });

  test("separates this week from all time", async () => {
    await insertBoost(testDatabase.db, {
      creatorId,
      amountCents: 1_000,
      confirmedAt: LAST_WEEK,
      supporterName: "Antiga",
      fanIdentityKey: "fan-antiga",
    });
    await insertBoost(testDatabase.db, {
      creatorId,
      amountCents: 2_000,
      confirmedAt: NOW,
      supporterName: "Atual",
      fanIdentityKey: "fan-atual",
    });

    const weekly = await torcida();
    expect(weekly.entries.map((entry) => entry.supporterName)).toEqual(["Atual"]);
    expect(weekly.totalAmountCents).toBe(2_000);

    const allTime = await torcida("?window=all-time");
    expect(allTime.window).toBe("all-time");
    expect(allTime.entries.map((entry) => entry.supporterName)).toEqual(["Atual", "Antiga"]);
    expect(allTime.totalAmountCents).toBe(3_000);
  });
});

describe("paging the wall", () => {
  beforeEach(async () => {
    for (let index = 0; index < 5; index += 1) {
      await insertBoost(testDatabase.db, {
        creatorId,
        amountCents: (index + 1) * 1_000,
        confirmedAt: NOW,
        supporterName: `Fa ${index}`,
        fanIdentityKey: `fan-${index}`,
      });
    }
  });

  test("reports the full size alongside the page", async () => {
    const page = await torcida("?limit=2");
    expect(page.entries).toHaveLength(2);
    expect(page.total).toBe(5);
    expect(page.supporterCount).toBe(5);
    expect(page.entries.map((entry) => entry.amountCents)).toEqual([5_000, 4_000]);
  });

  test("continues where the previous page ended", async () => {
    const page = await torcida("?limit=2&offset=2");
    expect(page.entries.map((entry) => entry.amountCents)).toEqual([3_000, 2_000]);
    expect(page.total).toBe(5);
  });

  test("answers an empty page past the end without losing the totals", async () => {
    const page = await torcida("?limit=2&offset=90");
    expect(page.entries).toHaveLength(0);
    expect(page.supporterCount).toBe(5);
    expect(page.totalAmountCents).toBe(15_000);
  });
});
