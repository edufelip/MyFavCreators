import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PRODUCT_DEFAULTS } from "@creator-outdoor/config";
import { getWeeklyPeriod } from "@creator-outdoor/domain";
import {
  createTestDatabase,
  insertBoost,
  insertCategory,
  insertCreator,
  rawSql,
  setCreatorModerationStatus,
  type TestDatabase,
} from "@creator-outdoor/testkit";
import { ConsoleEmailProvider } from "../../src/email/console";
import {
  EmailDeliveryError,
  type EmailMessage,
  type EmailProvider,
} from "../../src/email/provider";
import { subscribeToNotifications } from "../../src/services/notifications";
import { sendWeeklyRecaps } from "../../src/services/weekly-recap";

/** A Monday morning, just after the week the recap describes ended. */
const NOW = new Date("2026-08-24T09:00:00.000Z");
const LAST_WEEK = new Date(
  getWeeklyPeriod(NOW, PRODUCT_DEFAULTS.timezone, -1).startsAt.getTime() + 3_600_000,
);
const WEB_ORIGIN = "http://localhost:3000";

const testDatabase: TestDatabase = await createTestDatabase();
const email = new ConsoleEmailProvider();

let categoryId = "";

beforeEach(async () => {
  await testDatabase.truncate();
  email.clear();
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

async function creatorWithFollower(
  slug: string,
  followerEmail: string,
  amountCents: number | null,
) {
  const creator = await insertCreator(testDatabase.db, {
    categoryId,
    slug,
    displayName: slug,
    moderationStatus: "APPROVED",
  });
  if (amountCents !== null) {
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents,
      confirmedAt: LAST_WEEK,
    });
  }
  await subscribeToNotifications(testDatabase.db, {
    email: followerEmail,
    creatorId: creator.id,
    types: ["WEEKLY_RECAP"],
  });
  return creator;
}

function run(provider: EmailProvider = email) {
  return sendWeeklyRecaps(testDatabase.db, PRODUCT_DEFAULTS, provider, {
    now: NOW,
    webOrigin: WEB_ORIGIN,
  });
}

describe("the weekly recap", () => {
  test("tells a follower how the week that just ended went", async () => {
    await creatorWithFollower("luna-verso", "torcedora@example.com", 12_300);

    const summary = await run();
    expect(summary).toEqual({ considered: 1, sent: 1, skipped: 0, failed: 0 });

    const message = email.outbox()[0];
    expect(message?.to).toBe("torcedora@example.com");
    expect(message?.subject).toContain("#1");
    expect(message?.text).toContain("R$123");
    expect(message?.text).toContain("1 pessoa na torcida");
  });

  test("describes the closed week, not the one that just started", async () => {
    // A recap computed from "now" on a Monday morning would report an empty
    // week nobody has had time to boost in yet.
    const creator = await creatorWithFollower("recente", "torcedora@example.com", 5_000);
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 90_000,
      confirmedAt: NOW,
    });

    await run();
    expect(email.outbox()[0]?.text).toContain("R$50");
    expect(email.outbox()[0]?.text).not.toContain("R$900");
  });

  test("still writes to a follower of a creator nobody boosted", async () => {
    await creatorWithFollower("silenciosa", "torcedora@example.com", null);

    await run();
    const message = email.outbox()[0];
    expect(message?.text).toContain("sem impulsos nesta semana");
    expect(message?.text).toContain("R$0");
  });

  test("carries a one-click unsubscribe", async () => {
    await creatorWithFollower("com-link", "torcedora@example.com", 1_000);
    await run();
    expect(email.outbox()[0]?.unsubscribeUrl?.startsWith(`${WEB_ORIGIN}/api/descadastrar/`)).toBe(
      true,
    );
  });

  test("sends nothing a second time when the job runs twice", async () => {
    await creatorWithFollower("duas-vezes", "torcedora@example.com", 1_000);
    expect((await run()).sent).toBe(1);

    email.clear();
    const second = await run();
    expect(second).toEqual({ considered: 1, sent: 0, skipped: 1, failed: 0 });
    expect(email.outbox()).toHaveLength(0);
  });

  test("skips somebody who unsubscribed", async () => {
    await creatorWithFollower("nao-quer", "torcedora@example.com", 1_000);
    await testDatabase.db.execute(
      rawSql("update notification_subscriptions set disabled_at = now()"),
    );

    expect(await run()).toEqual({ considered: 0, sent: 0, skipped: 0, failed: 0 });
    expect(email.outbox()).toHaveLength(0);
  });

  test("says nothing about a creator who is no longer public", async () => {
    const creator = await creatorWithFollower("removida", "torcedora@example.com", 1_000);
    await setCreatorModerationStatus(testDatabase.db, creator.id, "REMOVED");

    expect(await run()).toEqual({ considered: 0, sent: 0, skipped: 0, failed: 0 });
  });

  test("retries a follower whose message could not be delivered", async () => {
    await creatorWithFollower("tenta-de-novo", "torcedora@example.com", 1_000);

    const failing: EmailProvider = {
      name: "failing",
      send: (_message: EmailMessage): Promise<void> =>
        Promise.reject(new EmailDeliveryError("the provider is down")),
    };
    expect(await run(failing)).toEqual({ considered: 1, sent: 0, skipped: 0, failed: 1 });

    // The claim was released, so the next run genuinely tries again.
    expect((await run()).sent).toBe(1);
    expect(email.outbox()).toHaveLength(1);
  });

  test("writes one message per creator a follower asked about", async () => {
    await creatorWithFollower("primeira", "torcedora@example.com", 5_000);
    await creatorWithFollower("segunda", "torcedora@example.com", 1_000);

    expect((await run()).sent).toBe(2);
    expect(email.outbox().map((message) => message.to)).toEqual([
      "torcedora@example.com",
      "torcedora@example.com",
    ]);
    const subjects = email.outbox().map((message) => message.subject);
    expect(new Set(subjects).size).toBe(2);
  });
});
