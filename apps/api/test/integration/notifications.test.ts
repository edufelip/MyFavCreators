import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PRODUCT_DEFAULTS } from "@creator-outdoor/config";
import { CheckoutDto, parseContract } from "@creator-outdoor/contracts";
import {
  createTestDatabase,
  insertCategory,
  insertCreator,
  type TestDatabase,
} from "@creator-outdoor/testkit";
import { createApp } from "../../src/app";
import { ConsoleEmailProvider } from "../../src/email/console";
import { FAKE_PIX_SIGNATURE_HEADER, FakePixPaymentProvider } from "../../src/payments/fake-pix";
import { RateLimiter } from "../../src/security/rate-limit";

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
  const rows = await testDatabase.db.execute(
    `select provider_payment_id from payments where id = '${paymentId}'` as never,
  );
  const row = (rows as Array<Record<string, unknown>>)[0];
  return String(row?.["provider_payment_id"] ?? "");
}

/** Buys a boost and settles it, exactly as the public flow does. */
async function boost(
  creatorSlug: string,
  amountCents: number,
  options: {
    readonly supporterEmail?: string;
    /** Defaults to true, because these tests are about what subscribers get. */
    readonly notifyOnDethrone?: boolean;
    readonly eventId?: string;
  } = {},
) {
  const response = await post("/v1/boosts", {
    creatorSlug,
    amountCents,
    supporterKey: `browser-${creatorSlug}-${amountCents}`,
    ...(options.supporterEmail === undefined ? {} : { supporterEmail: options.supporterEmail }),
    notifyOnDethrone: options.notifyOnDethrone ?? true,
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
  return { paymentId: checkout.paymentId, providerPaymentId, payload };
}

async function subscriptionCount(): Promise<number> {
  const rows = (await testDatabase.db.execute(
    "select count(*)::int as total from notification_subscriptions" as never,
  )) as Array<Record<string, unknown>>;
  return Number(rows[0]?.["total"] ?? 0);
}

describe("who hears about a creator", () => {
  test("a supporter who asked to hear is subscribed when their boost confirms", async () => {
    const creator = await approvedCreator("luna-verso");
    await boost(creator.slug, 5_000, { supporterEmail: "ana@example.com" });

    expect(await subscriptionCount()).toBe(1);
  });

  test("an address alone subscribes nobody", async () => {
    // The address is for the receipt. Being written to is a separate thing to
    // agree to, and it was not agreed to here.
    const creator = await approvedCreator("so-recibo");
    await boost(creator.slug, 5_000, {
      supporterEmail: "ana@example.com",
      notifyOnDethrone: false,
    });

    expect(await subscriptionCount()).toBe(0);
  });

  test("a supporter who left no address is not subscribed to anything", async () => {
    const creator = await approvedCreator("sem-email");
    await boost(creator.slug, 5_000);

    expect(await subscriptionCount()).toBe(0);
  });

  test("boosting the same creator repeatedly is still one subscription", async () => {
    const creator = await approvedCreator("repetido");
    await boost(creator.slug, 1_000, { supporterEmail: "Ana@Example.com" });
    await boost(creator.slug, 2_000, { supporterEmail: "ana@example.com " });

    // Two spellings of one inbox must not become two copies of every email.
    expect(await subscriptionCount()).toBe(1);
  });

  test("a pending payment subscribes nobody", async () => {
    const creator = await approvedCreator("pendente");
    await post("/v1/boosts", {
      creatorSlug: creator.slug,
      amountCents: 5_000,
      supporterKey: "browser-pendente",
      supporterEmail: "ana@example.com",
    });

    expect(await subscriptionCount()).toBe(0);
  });
});

describe("the dethrone notification", () => {
  test("reaches the followers of the creator who lost the top spot", async () => {
    const leader = await approvedCreator("primeiro-lugar");
    const challenger = await approvedCreator("desafiante");
    await boost(leader.slug, 5_000, { supporterEmail: "torcedora@example.com" });
    email.clear();

    await boost(challenger.slug, 9_000);

    const outbox = email.outbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.to).toBe("torcedora@example.com");
    expect(outbox[0]?.subject).toContain("desafiante");
    expect(outbox[0]?.text).toContain("assumiu o #1");
  });

  test("carries a one-click unsubscribe that points at the public site", async () => {
    const leader = await approvedCreator("lider");
    const challenger = await approvedCreator("rival");
    await boost(leader.slug, 5_000, { supporterEmail: "torcedora@example.com" });
    email.clear();
    await boost(challenger.slug, 9_000);

    const message = email.outbox()[0];
    expect(message?.unsubscribeUrl?.startsWith(`${WEB_ORIGIN}/descadastrar/`)).toBe(true);
    expect(message?.text).toContain("Para parar de receber");
  });

  test("is not sent for a climb that stops short of the top", async () => {
    const leader = await approvedCreator("intocavel");
    const middle = await approvedCreator("meio");
    const climber = await approvedCreator("subindo");
    await boost(leader.slug, 50_000, { supporterEmail: "lider@example.com" });
    await boost(middle.slug, 5_000, { supporterEmail: "meio@example.com" });
    await boost(climber.slug, 1_000);
    email.clear();

    // Passes the middle creator, still far from #1. Real movement, no email.
    await boost(climber.slug, 8_000);
    expect(email.outbox()).toHaveLength(0);
  });

  test("is sent once even if the provider redelivers the webhook", async () => {
    const leader = await approvedCreator("campea");
    const challenger = await approvedCreator("nova");
    await boost(leader.slug, 5_000, { supporterEmail: "torcedora@example.com" });
    email.clear();

    const { payload } = await boost(challenger.slug, 9_000);
    expect(email.outbox()).toHaveLength(1);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const repeated = await call(`/v1/webhooks/payments/${provider.name}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [FAKE_PIX_SIGNATURE_HEADER]: provider.sign(payload),
        },
        body: payload,
      });
      expect(await repeated.json()).toEqual({ received: true, outcome: "DUPLICATE" });
    }
    expect(email.outbox()).toHaveLength(1);
  });

  test("never mails the person who caused the overtake about their own creator", async () => {
    const leader = await approvedCreator("antiga");
    const challenger = await approvedCreator("nova-lider");
    await boost(challenger.slug, 1_000, { supporterEmail: "fa-da-nova@example.com" });
    await boost(leader.slug, 5_000);
    email.clear();

    await boost(challenger.slug, 9_000);
    // The follower asked about the creator they follow losing the top spot.
    // Their creator gained it, so there is nothing to tell them.
    expect(email.outbox()).toHaveLength(0);
  });
});

describe("unsubscribing", () => {
  async function tokenFor(email_: string): Promise<string> {
    const rows = (await testDatabase.db.execute(
      `select unsub_token from notification_subscriptions where email = '${email_}'` as never,
    )) as Array<Record<string, unknown>>;
    return String(rows[0]?.["unsub_token"] ?? "");
  }

  test("stops the next notification", async () => {
    const leader = await approvedCreator("dona-do-topo");
    const first = await approvedCreator("primeira-rival");
    const second = await approvedCreator("segunda-rival");
    await boost(leader.slug, 5_000, { supporterEmail: "torcedora@example.com" });

    const token = await tokenFor("torcedora@example.com");
    expect(token.length).toBeGreaterThan(20);
    const response = await post("/v1/notifications/unsubscribe", { token });
    expect(await response.json()).toEqual({ acknowledged: true });

    email.clear();
    await boost(first.slug, 9_000);
    expect(email.outbox()).toHaveLength(0);

    // And it stays off for every later happening, not just the next one.
    await boost(second.slug, 20_000);
    expect(email.outbox()).toHaveLength(0);
  });

  test("the token in the emailed link is the one that works", async () => {
    /*
     * Taken out of the URL rather than out of the table. Everywhere else the two
     * sides of this boundary agree by memory — the template builds a path, the
     * web route parses one, and a test that reads the token from the database
     * would pass even if the URL mangled it. What a person actually clicks is a
     * link, so that is what is exercised here.
     */
    const leader = await approvedCreator("dona-do-link");
    const rival = await approvedCreator("rival-do-link");
    await boost(leader.slug, 5_000, {
      supporterEmail: "clicou@example.com",
      notifyOnDethrone: true,
    });
    email.clear();
    await boost(rival.slug, 9_000);

    const link = email.outbox()[0]?.unsubscribeUrl ?? "";
    expect(link).toContain("/descadastrar/");
    const fromLink = decodeURIComponent(new URL(link).pathname.split("/").pop() ?? "");
    expect(fromLink).toBe(await tokenFor("clicou@example.com"));

    const response = await post("/v1/notifications/unsubscribe", { token: fromLink });
    expect(response.status).toBe(200);

    // And it really switched something off, rather than merely answering.
    const rows = (await testDatabase.db.execute(
      `select disabled_at from notification_subscriptions where email = 'clicou@example.com'` as never,
    )) as Array<Record<string, unknown>>;
    expect(rows[0]?.["disabled_at"]).not.toBeNull();
  });

  test("answers the same for a token that never existed", async () => {
    // A differing answer would let anybody holding a forwarded email test
    // whether an address is subscribed.
    const unknown = await post("/v1/notifications/unsubscribe", { token: "a".repeat(43) });
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ acknowledged: true });
  });

  test("answers the same when the link is used twice", async () => {
    const leader = await approvedCreator("duas-vezes");
    await boost(leader.slug, 5_000, { supporterEmail: "torcedora@example.com" });
    const token = await tokenFor("torcedora@example.com");

    expect((await post("/v1/notifications/unsubscribe", { token })).status).toBe(200);
    const second = await post("/v1/notifications/unsubscribe", { token });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ acknowledged: true });
  });

  test("boosting again brings the subscription back rather than duplicating it", async () => {
    const leader = await approvedCreator("voltou");
    const rival = await approvedCreator("rival-do-voltou");
    await boost(leader.slug, 1_000, { supporterEmail: "torcedora@example.com" });
    await post("/v1/notifications/unsubscribe", { token: await tokenFor("torcedora@example.com") });

    await boost(leader.slug, 2_000, { supporterEmail: "torcedora@example.com" });
    expect(await subscriptionCount()).toBe(1);

    email.clear();
    await boost(rival.slug, 9_000);
    expect(email.outbox()).toHaveLength(1);
  });
});
