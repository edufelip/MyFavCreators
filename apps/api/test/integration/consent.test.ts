import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PRODUCT_DEFAULTS } from "@creator-outdoor/config";
import { CheckoutDto, parseContract } from "@creator-outdoor/contracts";
import {
  createTestDatabase,
  insertCategory,
  insertCreator,
  rawSql,
  type TestDatabase,
} from "@creator-outdoor/testkit";
import { createApp } from "../../src/app";
import { ConsoleEmailProvider } from "../../src/email/console";
import { FAKE_PIX_SIGNATURE_HEADER, FakePixPaymentProvider } from "../../src/payments/fake-pix";
import { RateLimiter } from "../../src/security/rate-limit";

/**
 * Consent, end to end.
 *
 * An address left at checkout is for the receipt. Being written to is a
 * separate thing somebody has to ask for, and the box on the form is where they
 * ask. These tests exist because that box was being ignored.
 */

const NOW = new Date("2026-08-19T18:30:00.000Z");
const FAN_SECRET = "um-segredo-de-identidade-de-fa-com-32-bytes";
const WEB_ORIGIN = "http://localhost:3000";

const testDatabase: TestDatabase = await createTestDatabase();
const rateLimiter = new RateLimiter();
const email = new ConsoleEmailProvider();
const provider = new FakePixPaymentProvider({
  expirationMinutes: PRODUCT_DEFAULTS.fakePixExpirationMinutes,
  signingSecret: FAN_SECRET,
  now: () => NOW,
});
const app = createApp({
  database: testDatabase.db,
  product: PRODUCT_DEFAULTS,
  allowedOrigins: [WEB_ORIGIN],
  adminApiSecret: "integration-admin-secret-value",
  fanIdentitySecret: FAN_SECRET,
  paymentProvider: provider,
  emailProvider: email,
  webOrigin: WEB_ORIGIN,
  rateLimiter,
  now: () => NOW,
});

let categoryId = "";

beforeEach(async () => {
  await testDatabase.truncate();
  rateLimiter.reset();
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

async function call(path: string, init?: RequestInit): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`, init));
}

async function post(path: string, body: unknown) {
  return call(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function approvedCreator(slug: string) {
  return insertCreator(testDatabase.db, {
    categoryId,
    slug,
    displayName: slug,
    moderationStatus: "APPROVED",
  });
}

async function providerPaymentIdFor(paymentId: string): Promise<string> {
  const rows = (await testDatabase.db.execute(
    rawSql(`select provider_payment_id from payments where id = '${paymentId}'`),
  )) as Array<Record<string, unknown>>;
  return String(rows[0]?.["provider_payment_id"] ?? "");
}

type BoostOptions = {
  readonly supporterEmail?: string;
  readonly notifyOnDethrone?: boolean;
  readonly notifyWeeklyRecap?: boolean;
  readonly eventId?: string;
};

/** Buys a boost and settles it, exactly as the public flow does. */
async function boost(creatorSlug: string, amountCents: number, options: BoostOptions = {}) {
  const response = await post("/v1/boosts", {
    creatorSlug,
    amountCents,
    supporterKey: `browser-${creatorSlug}-${amountCents}`,
    ...(options.supporterEmail === undefined ? {} : { supporterEmail: options.supporterEmail }),
    ...(options.notifyOnDethrone === undefined
      ? {}
      : { notifyOnDethrone: options.notifyOnDethrone }),
    ...(options.notifyWeeklyRecap === undefined
      ? {}
      : { notifyWeeklyRecap: options.notifyWeeklyRecap }),
  });
  const checkout = parseContract(CheckoutDto, await response.json(), "Checkout");
  const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);

  const payload = JSON.stringify({
    eventId: options.eventId ?? `evt-${creatorSlug}-${amountCents}`,
    providerPaymentId,
    status: "CONFIRMED",
  });
  const webhook = await call(`/v1/webhooks/payments/${provider.name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [FAKE_PIX_SIGNATURE_HEADER]: provider.sign(payload),
    },
    body: payload,
  });
  expect(await webhook.json()).toEqual({ received: true, outcome: "APPLIED" });
  return checkout.paymentId;
}

async function subscriptions(): Promise<Array<{ email: string; type: string }>> {
  const rows = (await testDatabase.db.execute(
    rawSql(
      "select email, type from notification_subscriptions where disabled_at is null order by type",
    ),
  )) as Array<Record<string, unknown>>;
  return rows.map((row) => ({ email: String(row["email"]), type: String(row["type"]) }));
}

describe("the notification consent box", () => {
  test("subscribes to exactly the thing that was ticked, and nothing else", async () => {
    /*
     * The box says "avise se este perfil perder o topo". Adding a weekly recap
     * on the back of it would be the same overreach in a new shape, so each
     * notification is its own subscription and its own question.
     */
    const creator = await approvedCreator("luna-verso");
    await boost(creator.slug, 5_000, {
      supporterEmail: "ana@example.com",
      notifyOnDethrone: true,
    });

    expect(await subscriptions()).toEqual([{ email: "ana@example.com", type: "DETHRONE" }]);
  });

  test("subscribes to the recap when that is what was ticked", async () => {
    const creator = await approvedCreator("so-resumo");
    await boost(creator.slug, 5_000, {
      supporterEmail: "ana@example.com",
      notifyWeeklyRecap: true,
    });

    expect(await subscriptions()).toEqual([{ email: "ana@example.com", type: "WEEKLY_RECAP" }]);
  });

  test("subscribes to both when both were ticked", async () => {
    const creator = await approvedCreator("os-dois");
    await boost(creator.slug, 5_000, {
      supporterEmail: "ana@example.com",
      notifyOnDethrone: true,
      notifyWeeklyRecap: true,
    });

    expect((await subscriptions()).map((row) => row.type)).toEqual(["DETHRONE", "WEEKLY_RECAP"]);
  });

  test("subscribes nobody who left it unticked", async () => {
    // The address is still stored — it is what a receipt goes to — but nothing
    // is ever sent to it, because nobody asked for anything to be.
    const creator = await approvedCreator("sem-avisos");
    await boost(creator.slug, 5_000, {
      supporterEmail: "ana@example.com",
      notifyOnDethrone: false,
      notifyWeeklyRecap: false,
    });

    expect(await subscriptions()).toEqual([]);
  });

  test("subscribes nobody when the boxes are simply absent", async () => {
    // An API client that says nothing has consented to nothing. Silence is not
    // agreement.
    const creator = await approvedCreator("sem-campo");
    await boost(creator.slug, 5_000, { supporterEmail: "ana@example.com" });

    expect(await subscriptions()).toEqual([]);
  });

  test("subscribes nobody who ticked it but left no address", async () => {
    const creator = await approvedCreator("sem-endereco");
    await boost(creator.slug, 5_000, { notifyOnDethrone: true });

    expect(await subscriptions()).toEqual([]);
  });

  test("never writes to somebody who declined, even when the leader changes", async () => {
    const leader = await approvedCreator("lider");
    const rival = await approvedCreator("rival");
    await boost(leader.slug, 5_000, {
      supporterEmail: "recusou@example.com",
      notifyOnDethrone: false,
    });
    email.clear();

    // Subscribed to the recap, which says nothing about a leader changing.
    await boost(rival.slug, 9_000);
    expect(email.outbox()).toHaveLength(0);
  });

  test("writes to somebody who accepted when the leader changes", async () => {
    const leader = await approvedCreator("lider-2");
    const rival = await approvedCreator("rival-2");
    await boost(leader.slug, 5_000, {
      supporterEmail: "aceitou@example.com",
      notifyOnDethrone: true,
    });
    email.clear();

    await boost(rival.slug, 9_000);
    expect(email.outbox().map((message) => message.to)).toEqual(["aceitou@example.com"]);
  });

  test("remembers the choice on the boost that carried it", async () => {
    // The consent belongs to the boost that was paid for, not to a session or a
    // form that has since been closed.
    const creator = await approvedCreator("registrado");
    await boost(creator.slug, 5_000, {
      supporterEmail: "ana@example.com",
      notifyOnDethrone: true,
    });

    const rows = (await testDatabase.db.execute(
      rawSql("select notify_on_dethrone, notify_weekly_recap from boosts"),
    )) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["notify_on_dethrone"]).toBe(true);
    expect(rows[0]?.["notify_weekly_recap"]).toBe(false);
  });

  test("an unsubscribe survives a later boost that does not ask again", async () => {
    /*
     * This is the regression itself. Somebody accepted, changed their mind and
     * unsubscribed, then bought another boost — and the old code re-subscribed
     * them from the address alone, silently undoing the choice they had just
     * made. A boost that does not ask must not answer on their behalf.
     */
    await approvedCreator("volta-atras");
    await boost("volta-atras", 1_000, {
      supporterEmail: "quem.mudou@example.com",
      notifyOnDethrone: true,
    });
    expect(await subscriptions()).toEqual([{ email: "quem.mudou@example.com", type: "DETHRONE" }]);

    await testDatabase.db.execute(
      rawSql(`update notification_subscriptions set disabled_at = now()
       where email = 'quem.mudou@example.com'`),
    );
    expect(await subscriptions()).toEqual([]);

    await boost("volta-atras", 2_000, { supporterEmail: "quem.mudou@example.com" });

    expect(await subscriptions()).toEqual([]);
  });

  test("an unsubscribe survives a later boost that explicitly declines", async () => {
    await approvedCreator("declina-depois");
    await boost("declina-depois", 1_000, {
      supporterEmail: "declinou@example.com",
      notifyWeeklyRecap: true,
    });
    await testDatabase.db.execute(
      rawSql(`update notification_subscriptions set disabled_at = now()
       where email = 'declinou@example.com'`),
    );

    await boost("declina-depois", 2_000, {
      supporterEmail: "declinou@example.com",
      notifyWeeklyRecap: false,
    });

    expect(await subscriptions()).toEqual([]);
  });

  test("a later boost that accepts revives a subscription an earlier one declined", async () => {
    const creator = await approvedCreator("mudou-de-ideia");
    await boost(creator.slug, 1_000, {
      supporterEmail: "ana@example.com",
      notifyOnDethrone: false,
    });
    expect(await subscriptions()).toEqual([]);

    await boost(creator.slug, 2_000, {
      supporterEmail: "ana@example.com",
      notifyOnDethrone: true,
    });
    expect((await subscriptions()).map((row) => row.type)).toEqual(["DETHRONE"]);
  });

  test("a later boost that declines does not silently unsubscribe an earlier yes", async () => {
    /*
     * Declining is "do not start", not "stop". Stopping is what the unsubscribe
     * link is for, and quietly cancelling somebody's existing subscription
     * because they left a box unticked on an unrelated purchase would be its own
     * kind of surprise.
     */
    const creator = await approvedCreator("continua-inscrita");
    await boost(creator.slug, 1_000, {
      supporterEmail: "ana@example.com",
      notifyOnDethrone: true,
    });
    await boost(creator.slug, 2_000, {
      supporterEmail: "ana@example.com",
      notifyOnDethrone: false,
    });

    expect((await subscriptions()).map((row) => row.type)).toEqual(["DETHRONE"]);
  });
});
