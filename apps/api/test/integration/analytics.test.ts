import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PRODUCT_DEFAULTS } from "@creator-outdoor/config";
import {
  DeliveryReportDto,
  ImpressionBatchResponseDto,
  OutboundClickResponseDto,
  parseContract,
} from "@creator-outdoor/contracts";
import { getWeeklyPeriod, IMPRESSION_BATCH_MAX } from "@creator-outdoor/domain";
import {
  createTestDatabase,
  findPrimaryLinkId,
  insertCategory,
  insertCreator,
  setCreatorModerationStatus,
  type TestDatabase,
} from "@creator-outdoor/testkit";
import { createApp } from "../../src/app";
import { RateLimiter } from "../../src/security/rate-limit";

const NOW = new Date("2026-08-19T18:47:31.000Z");
const NEXT_HOUR = new Date("2026-08-19T19:05:00.000Z");
const LAST_WEEK = new Date(
  getWeeklyPeriod(NOW, PRODUCT_DEFAULTS.timezone, -1).startsAt.getTime() + 3_600_000,
);
const SESSION = "session-de-analytics-1";
const SESSION_HEADER = "x-analytics-session";

const testDatabase: TestDatabase = await createTestDatabase();
const rateLimiter = new RateLimiter();
let clock = NOW;
const app = createApp({
  database: testDatabase.db,
  product: PRODUCT_DEFAULTS,
  allowedOrigins: ["http://localhost:3000"],
  adminApiSecret: "integration-admin-secret-value",
  fanIdentitySecret: "um-segredo-de-identidade-de-fa-com-32-bytes",
  rateLimiter,
  now: () => clock,
});

let creatorId = "";
let linkId = "";

beforeEach(async () => {
  await testDatabase.truncate();
  rateLimiter.reset();
  clock = NOW;
  const category = await insertCategory(testDatabase.db, {
    slug: "musica",
    name: "Musica",
    isActive: true,
  });
  const creator = await insertCreator(testDatabase.db, {
    categoryId: category.id,
    slug: "luna-verso",
    displayName: "Luna Verso",
    moderationStatus: "APPROVED",
  });
  creatorId = creator.id;
  linkId = await findPrimaryLinkId(testDatabase.db, creator.id);
});

afterAll(async () => {
  await testDatabase.close();
});

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", [SESSION_HEADER]: SESSION, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

async function reportImpressions(
  entries: ReadonlyArray<{ creatorId: string; surface: string }>,
  headers: Record<string, string> = {},
) {
  const response = await post("/v1/impressions", { entries }, headers);
  expect(response.status).toBe(200);
  return parseContract(
    ImpressionBatchResponseDto,
    await response.json(),
    "ImpressionBatchResponse",
  );
}

async function clickThrough(headers: Record<string, string> = {}) {
  const response = await post("/v1/outbound-clicks", { creatorLinkId: linkId }, headers);
  expect(response.status).toBe(200);
  return parseContract(OutboundClickResponseDto, await response.json(), "OutboundClickResponse");
}

async function delivery(query = ""): Promise<DeliveryReportDto> {
  const response = await app.handle(
    new Request(`http://localhost/v1/creators/luna-verso/delivery${query}`),
  );
  expect(response.status).toBe(200);
  return parseContract(DeliveryReportDto, await response.json(), "DeliveryReport");
}

describe("counting impressions", () => {
  test("records what a page displayed", async () => {
    const result = await reportImpressions([
      { creatorId, surface: "LEADERBOARD" },
      { creatorId, surface: "ROTATION" },
    ]);
    expect(result.recorded).toBe(2);

    const report = await delivery();
    expect(report.impressions).toBe(2);
    expect(report.bySurface).toEqual([
      { surface: "LEADERBOARD", impressions: 1 },
      { surface: "ROTATION", impressions: 1 },
    ]);
  });

  test("counts a creator once per surface however often the page reports it", async () => {
    // A retried beacon, a restored back/forward page, a double-fired effect.
    expect(
      (
        await reportImpressions([
          { creatorId, surface: "LEADERBOARD" },
          { creatorId, surface: "LEADERBOARD" },
        ])
      ).recorded,
    ).toBe(1);
    expect((await reportImpressions([{ creatorId, surface: "LEADERBOARD" }])).recorded).toBe(0);
    expect((await delivery()).impressions).toBe(1);
  });

  test("counts the same creator again in the next hour", async () => {
    await reportImpressions([{ creatorId, surface: "LEADERBOARD" }]);
    clock = NEXT_HOUR;
    expect((await reportImpressions([{ creatorId, surface: "LEADERBOARD" }])).recorded).toBe(1);
    expect((await delivery()).impressions).toBe(2);
  });

  test("counts a second visitor separately", async () => {
    await reportImpressions([{ creatorId, surface: "LEADERBOARD" }]);
    const other = await post(
      "/v1/impressions",
      { entries: [{ creatorId, surface: "LEADERBOARD" }] },
      { [SESSION_HEADER]: "session-de-outra-pessoa" },
    );
    expect(await other.json()).toEqual({ recorded: 1 });
    expect((await delivery()).impressions).toBe(2);
  });

  test("refuses a request that names no session", async () => {
    // A caller who could choose its own session could mint impressions at will.
    const response = await app.handle(
      new Request("http://localhost/v1/impressions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries: [{ creatorId, surface: "LEADERBOARD" }] }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await delivery()).impressions).toBe(0);
  });

  test("refuses a batch larger than a page could honestly produce", async () => {
    const entries = Array.from({ length: IMPRESSION_BATCH_MAX + 1 }, () => ({
      creatorId,
      surface: "LEADERBOARD",
    }));
    const response = await post("/v1/impressions", { entries });
    expect(response.status).toBe(400);
  });

  test("refuses an unknown surface and an empty batch", async () => {
    expect(
      (await post("/v1/impressions", { entries: [{ creatorId, surface: "RANKING" }] })).status,
    ).toBe(400);
    expect((await post("/v1/impressions", { entries: [] })).status).toBe(400);
  });

  test("refuses an impression for a creator that does not exist", async () => {
    const response = await post("/v1/impressions", {
      entries: [{ creatorId: "00000000-0000-4000-8000-000000000000", surface: "LEADERBOARD" }],
    });
    // The foreign key refuses it; nothing is invented for a creator nobody has.
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe("tracked outbound links", () => {
  test("answers the stored destination and counts the click", async () => {
    const resolved = await clickThrough();
    expect(resolved.creatorSlug).toBe("luna-verso");
    expect(resolved.url.startsWith("https://")).toBe(true);
    expect(resolved.counted).toBe(true);

    expect((await delivery()).outboundClicks).toBe(1);
  });

  test("still redirects when the click was already counted this hour", async () => {
    const first = await clickThrough();
    const second = await clickThrough();

    expect(second.url).toBe(first.url);
    // The visitor is never stranded by deduplication.
    expect(second.counted).toBe(false);
    expect((await delivery()).outboundClicks).toBe(1);
  });

  test("still redirects a visitor with no analytics session, without counting", async () => {
    // Somebody arriving from outside the site has no session yet. Creating one
    // to count them would mean starting to track a visitor who only clicked a
    // link, so the click goes uncounted and the redirect still works.
    const response = await app.handle(
      new Request("http://localhost/v1/outbound-clicks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ creatorLinkId: linkId }),
      }),
    );
    expect(response.status).toBe(200);
    const resolved = parseContract(
      OutboundClickResponseDto,
      await response.json(),
      "OutboundClickResponse",
    );
    expect(resolved.url.startsWith("https://")).toBe(true);
    expect(resolved.counted).toBe(false);
    expect((await delivery()).outboundClicks).toBe(0);
  });

  test("refuses a link nobody has", async () => {
    const response = await post("/v1/outbound-clicks", {
      creatorLinkId: "00000000-0000-4000-8000-000000000000",
    });
    expect(response.status).toBe(404);
  });

  test("stops redirecting the moment the creator stops being public", async () => {
    await setCreatorModerationStatus(testDatabase.db, creatorId, "REMOVED");
    const response = await post("/v1/outbound-clicks", { creatorLinkId: linkId });
    expect(response.status).toBe(404);
  });

  test("never redirects to a destination the caller supplied", async () => {
    const response = await post("/v1/outbound-clicks", {
      creatorLinkId: linkId,
      url: "https://evil.example/phishing",
    });
    const resolved = parseContract(
      OutboundClickResponseDto,
      await response.json(),
      "OutboundClickResponse",
    );
    expect(resolved.url).not.toContain("evil.example");
  });
});

describe("the delivery report", () => {
  test("is all zeroes and states no rate before anything was shown", async () => {
    const report = await delivery();
    expect(report.impressions).toBe(0);
    expect(report.outboundClicks).toBe(0);
    // Zero out of zero is not zero percent; it is a rate nobody can state.
    expect(report.clickThroughRate).toBeNull();
  });

  test("divides clicks by impressions", async () => {
    for (let hour = 0; hour < 4; hour += 1) {
      clock = new Date(NOW.getTime() + hour * 3_600_000);
      await reportImpressions([{ creatorId, surface: "LEADERBOARD" }]);
    }
    clock = NOW;
    await clickThrough();

    const report = await delivery();
    expect(report.impressions).toBe(4);
    expect(report.outboundClicks).toBe(1);
    expect(report.clickThroughRate).toBe(0.25);
  });

  test("separates this week from all time", async () => {
    clock = LAST_WEEK;
    await reportImpressions([{ creatorId, surface: "LEADERBOARD" }]);
    clock = NOW;
    await reportImpressions([{ creatorId, surface: "LEADERBOARD" }]);

    expect((await delivery()).impressions).toBe(1);
    const allTime = await delivery("?window=all-time");
    expect(allTime.impressions).toBe(2);
    expect(allTime.periodStartsAt).toBeNull();
  });

  test("answers 404 for a creator who is not public", async () => {
    await setCreatorModerationStatus(testDatabase.db, creatorId, "REMOVED");
    const response = await app.handle(
      new Request("http://localhost/v1/creators/luna-verso/delivery"),
    );
    expect(response.status).toBe(404);
  });
});

describe("analytics and the ranking", () => {
  test("impressions and clicks move no position", async () => {
    const rival = await insertCreator(testDatabase.db, {
      categoryId: (await insertCategory(testDatabase.db, { slug: "jogos", name: "Jogos" })).id,
      slug: "rival",
      moderationStatus: "APPROVED",
    });
    for (let hour = 0; hour < 12; hour += 1) {
      clock = new Date(NOW.getTime() + hour * 3_600_000);
      await reportImpressions([{ creatorId, surface: "LEADERBOARD" }]);
      await clickThrough();
    }
    clock = NOW;

    // Traffic is not money. Neither creator has any, so neither ranks.
    const ranking = await app.handle(new Request("http://localhost/v1/rankings/weekly"));
    const body = (await ranking.json()) as { entries: unknown[] };
    expect(body.entries).toHaveLength(0);
    expect(rival.id).not.toBe(creatorId);
  });
});
