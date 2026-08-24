import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PRODUCT_DEFAULTS } from "@creator-outdoor/config";
import {
  CheckoutDto,
  LeaderboardResponseDto,
  PaymentStatusResponseDto,
  parseContract,
} from "@creator-outdoor/contracts";
import {
  createTestDatabase,
  insertCategory,
  insertCreator,
  setCreatorModerationStatus,
  type TestDatabase,
} from "@creator-outdoor/testkit";
import { createApp } from "../../src/app";
import { FAKE_PIX_SIGNATURE_HEADER, FakePixPaymentProvider } from "../../src/payments/fake-pix";
import { RateLimiter } from "../../src/security/rate-limit";

const NOW = new Date("2026-08-19T18:30:00.000Z");
const FAN_SECRET = "um-segredo-de-identidade-de-fa-com-32-bytes";

const testDatabase: TestDatabase = await createTestDatabase();
const rateLimiter = new RateLimiter();
const provider = new FakePixPaymentProvider({
  expirationMinutes: PRODUCT_DEFAULTS.fakePixExpirationMinutes,
  signingSecret: FAN_SECRET,
  now: () => NOW,
});
const app = createApp({
  database: testDatabase.db,
  product: PRODUCT_DEFAULTS,
  allowedOrigins: ["http://localhost:3000"],
  adminApiSecret: "integration-admin-secret-value",
  fanIdentitySecret: FAN_SECRET,
  paymentProvider: provider,
  rateLimiter,
  now: () => NOW,
});

let creatorSlug = "";
let creatorId = "";

beforeEach(async () => {
  await testDatabase.truncate();
  rateLimiter.reset();
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
  creatorSlug = creator.slug;
  creatorId = creator.id;
});

afterAll(async () => {
  await testDatabase.close();
});

async function call(path: string, init?: RequestInit): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`, init));
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return call(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function createCheckout(overrides: Record<string, unknown> = {}) {
  const response = await post("/v1/boosts", {
    creatorSlug,
    amountCents: 5_000,
    supporterKey: "browser-key-fixed",
    ...overrides,
  });
  return { response, body: await response.json() };
}

/** Delivers a webhook the way the provider would, correctly signed. */
async function deliverWebhook(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  return call(`/v1/webhooks/payments/${provider.name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [FAKE_PIX_SIGNATURE_HEADER]: provider.sign(body),
    },
    body,
  });
}

async function providerPaymentIdFor(paymentId: string): Promise<string> {
  const rows = await testDatabase.db.execute(
    // Reading the provider identifier is a test-only concern; it is never public.
    `select provider_payment_id from payments where id = '${paymentId}'` as never,
  );
  const row = (rows as Array<Record<string, unknown>>)[0];
  return String(row?.["provider_payment_id"] ?? "");
}

/** A second approved creator, so the ranking has someone to move against. */
async function insertRival(slug = "rival") {
  const category = await insertCategory(testDatabase.db, { slug: "outros", name: "Outros" });
  return insertCreator(testDatabase.db, {
    categoryId: category.id,
    slug,
    moderationStatus: "APPROVED",
  });
}

/** Opens a checkout for an already-existing creator and confirms it. */
async function confirmBoostFor(slug: string, amountCents: number, eventId: string) {
  const checkout = parseContract(
    CheckoutDto,
    (await post("/v1/boosts", {
      creatorSlug: slug,
      amountCents,
      supporterKey: `${slug}-${amountCents}`,
    }).then((response) => response.json())) as unknown,
    "Checkout",
  );
  await deliverWebhook({
    eventId,
    providerPaymentId: await providerPaymentIdFor(checkout.paymentId),
    status: "CONFIRMED",
  });
  return checkout.paymentId;
}

async function confirmMyBoost(amountCents: number, eventId: string) {
  return confirmBoostFor(creatorSlug, amountCents, eventId);
}

async function paymentStatus(paymentId: string) {
  return parseContract(
    PaymentStatusResponseDto,
    await (await call(`/v1/payments/${paymentId}/status`)).json(),
    "PaymentStatusResponse",
  );
}

async function weeklyEntries() {
  const payload = parseContract(
    LeaderboardResponseDto,
    await (await call("/v1/rankings/weekly")).json(),
    "LeaderboardResponse",
  );
  return payload.entries;
}

describe("creating a boost", () => {
  test("returns a PIX checkout and changes no ranking", async () => {
    const { response, body } = await createCheckout();
    expect(response.status).toBe(200);
    const checkout = parseContract(CheckoutDto, body, "Checkout");
    expect(checkout.amountCents).toBe(5_000);
    expect(checkout.status).toBe("PENDING");
    expect(checkout.copyPaste.length).toBeGreaterThan(0);

    // Nothing is ranked until the money settles.
    expect(await weeklyEntries()).toHaveLength(0);
  });

  test("never exposes the provider payment identifier", async () => {
    const { body } = await createCheckout();
    const text = JSON.stringify(body);
    expect(text.includes("providerPaymentId")).toBe(false);
    expect(text.includes("fake_")).toBe(false);
    expect(Object.keys(body as object).sort()).toEqual([
      "amountCents",
      "boostId",
      "copyPaste",
      "creatorDisplayName",
      "creatorSlug",
      "expiresAt",
      "origin",
      "paymentId",
      "qrCode",
      "status",
    ]);
  });

  test("refuses an amount below the minimum boost", async () => {
    const { response } = await createCheckout({ amountCents: 499 });
    expect(response.status).toBe(422);
  });

  test("refuses a creator who is not publicly eligible", async () => {
    await setCreatorModerationStatus(testDatabase.db, creatorId, "REMOVED");
    const { response } = await createCheckout();
    expect(response.status).toBe(404);
  });

  test("refuses a creator that does not exist, indistinguishably", async () => {
    const missing = await post("/v1/boosts", {
      creatorSlug: "nunca-existiu",
      amountCents: 5_000,
      supporterKey: "browser-key-fixed",
    });
    await setCreatorModerationStatus(testDatabase.db, creatorId, "PENDING_REVIEW");
    const hidden = await createCheckout();
    expect(missing.status).toBe(hidden.response.status);
  });

  test("stores no supporter name or message for an anonymous boost", async () => {
    const { body } = await createCheckout({
      anonymous: true,
      supporterName: "Marina",
      supporterMessage: "Vamos pro topo",
    });
    const checkout = parseContract(CheckoutDto, body, "Checkout");
    const rows = (await testDatabase.db.execute(
      `select supporter_name, supporter_message, anonymous from boosts where id = '${checkout.boostId}'` as never,
    )) as Array<Record<string, unknown>>;
    expect(rows[0]?.["supporter_name"]).toBeNull();
    expect(rows[0]?.["supporter_message"]).toBeNull();
    expect(rows[0]?.["anonymous"]).toBe(true);
  });
});

describe("stored payment metadata", () => {
  test("is a real JSON object, so it stays queryable and indexable", async () => {
    const { body } = await createCheckout();
    const checkout = parseContract(CheckoutDto, body, "Checkout");

    // Drizzle's built-in jsonb() plus Bun's SQL driver would double-encode this
    // into a JSON string, making every `->>` lookup null for ever.
    const rows = (await testDatabase.db.execute(
      `select jsonb_typeof(raw_metadata) as type, raw_metadata->>'origin' as origin
       from payments where id = '${checkout.paymentId}'` as never,
    )) as Array<Record<string, unknown>>;
    expect(rows[0]?.["type"]).toBe("object");
    expect(rows[0]?.["origin"]).toBe("DIRECT");
  });

  test("payment events and audit entries store objects too", async () => {
    const { body } = await createCheckout();
    const checkout = parseContract(CheckoutDto, body, "Checkout");
    const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);
    await deliverWebhook({ eventId: "evt-json", providerPaymentId, status: "CONFIRMED" });
    await deliverWebhook({ eventId: "evt-json-r", providerPaymentId, status: "REFUNDED" });

    const events = (await testDatabase.db.execute(
      "select jsonb_typeof(payload) as type from payment_events" as never,
    )) as Array<Record<string, unknown>>;
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event["type"]).toBe("object");
    }

    const audits = (await testDatabase.db.execute(
      "select jsonb_typeof(metadata) as type from audit_logs" as never,
    )) as Array<Record<string, unknown>>;
    expect(audits.length).toBeGreaterThan(0);
    for (const audit of audits) {
      expect(audit["type"]).toBe("object");
    }
  });
});

describe("payment confirmation", () => {
  test("activates exactly one boost and moves the ranking", async () => {
    const { body } = await createCheckout();
    const checkout = parseContract(CheckoutDto, body, "Checkout");
    const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);

    const webhook = await deliverWebhook({
      eventId: "evt-1",
      providerPaymentId,
      status: "CONFIRMED",
    });
    expect(webhook.status).toBe(200);
    expect(await webhook.json()).toEqual({ received: true, outcome: "APPLIED" });

    const entries = await weeklyEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.amountCents).toBe(5_000);
    expect(entries[0]?.creator.slug).toBe(creatorSlug);
  });

  test("a duplicate delivery activates nothing twice", async () => {
    const { body } = await createCheckout();
    const checkout = parseContract(CheckoutDto, body, "Checkout");
    const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);
    const event = { eventId: "evt-dup", providerPaymentId, status: "CONFIRMED" };

    const first = await deliverWebhook(event);
    expect(await first.json()).toEqual({ received: true, outcome: "APPLIED" });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const repeat = await deliverWebhook(event);
      expect(repeat.status).toBe(200);
      expect(await repeat.json()).toEqual({ received: true, outcome: "DUPLICATE" });
    }

    const entries = await weeklyEntries();
    expect(entries[0]?.amountCents).toBe(5_000);
    expect(entries[0]?.supporterCount).toBe(1);
  });

  test("concurrent deliveries of the same event still activate once", async () => {
    const { body } = await createCheckout();
    const checkout = parseContract(CheckoutDto, body, "Checkout");
    const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);
    const event = { eventId: "evt-race", providerPaymentId, status: "CONFIRMED" };

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, async () => (await deliverWebhook(event)).json()),
    );
    const applied = outcomes.filter(
      (outcome) => (outcome as { outcome: string }).outcome === "APPLIED",
    );
    expect(applied).toHaveLength(1);

    const entries = await weeklyEntries();
    expect(entries[0]?.amountCents).toBe(5_000);
  });

  test("stamps the rotation window at confirmation", async () => {
    const { body } = await createCheckout();
    const checkout = parseContract(CheckoutDto, body, "Checkout");
    const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);
    await deliverWebhook({ eventId: "evt-rot", providerPaymentId, status: "CONFIRMED" });

    const rows = (await testDatabase.db.execute(
      `select rotation_starts_at, rotation_ends_at, confirmed_at from boosts where id = '${checkout.boostId}'` as never,
    )) as Array<Record<string, unknown>>;
    const startsAt = new Date(String(rows[0]?.["rotation_starts_at"]));
    const endsAt = new Date(String(rows[0]?.["rotation_ends_at"]));
    expect(startsAt.toISOString()).toBe(NOW.toISOString());
    expect(endsAt.getTime() - startsAt.getTime()).toBe(
      PRODUCT_DEFAULTS.rotationHours * 60 * 60 * 1000,
    );
  });

  test("reports the position the customer actually reached", async () => {
    // Someone else is already ahead with R$100.
    const rival = await insertCreator(testDatabase.db, {
      categoryId: (await insertCategory(testDatabase.db, { slug: "outros", name: "Outros" })).id,
      slug: "rival",
      moderationStatus: "APPROVED",
    });
    const rivalCheckout = parseContract(
      CheckoutDto,
      (await post("/v1/boosts", {
        creatorSlug: rival.slug,
        amountCents: 10_000,
        supporterKey: "rival-key",
      }).then((response) => response.json())) as unknown,
      "Checkout",
    );
    await deliverWebhook({
      eventId: "evt-rival",
      providerPaymentId: await providerPaymentIdFor(rivalCheckout.paymentId),
      status: "CONFIRMED",
    });

    const { body } = await createCheckout({ amountCents: 5_000 });
    const checkout = parseContract(CheckoutDto, body, "Checkout");
    await deliverWebhook({
      eventId: "evt-mine",
      providerPaymentId: await providerPaymentIdFor(checkout.paymentId),
      status: "CONFIRMED",
    });

    const status = parseContract(
      PaymentStatusResponseDto,
      await (await call(`/v1/payments/${checkout.paymentId}/status`)).json(),
      "PaymentStatusResponse",
    );
    expect(status.status).toBe("CONFIRMED");
    expect(status.boostStatus).toBe("ACTIVE");
    // Entered the ranking at #2 rather than reaching #1.
    expect(status.movement?.toRank).toBe(2);
    expect(status.movement?.fromRank).toBeNull();
  });

  test("never invents a climb for a boost that moved nobody", async () => {
    // The most dangerous thing this screen could do is tell someone their money
    // bought a position it did not buy. A second boost that leaves the creator
    // exactly where they were has to say so.
    await insertRival();
    await confirmBoostFor("rival", 10_000, "evt-rival-still");
    await confirmMyBoost(3_000, "evt-mine-first");
    const second = await confirmMyBoost(2_000, "evt-mine-second");

    const status = await paymentStatus(second);
    expect(status.movement).toEqual({
      fromRank: 2,
      toRank: 2,
      positionsGained: 0,
      direction: "NONE",
    });
  });

  test("counts the positions a repeat customer actually gained", async () => {
    await insertRival();
    await confirmBoostFor("rival", 10_000, "evt-rival-passed");
    await confirmMyBoost(3_000, "evt-mine-entry");
    const winning = await confirmMyBoost(9_000, "evt-mine-winning");

    // Second to first: one position, not two. The creator's own new total is
    // not somebody standing ahead of their old one.
    const status = await paymentStatus(winning);
    expect(status.movement).toEqual({
      fromRank: 2,
      toRank: 1,
      positionsGained: 1,
      direction: "UP",
    });
  });
});

describe("payments that never settle", () => {
  for (const status of ["FAILED", "EXPIRED", "CANCELLED"] as const) {
    test(`a ${status} payment voids the boost and never ranks`, async () => {
      const { body } = await createCheckout();
      const checkout = parseContract(CheckoutDto, body, "Checkout");
      const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);

      await deliverWebhook({ eventId: `evt-${status}`, providerPaymentId, status });

      expect(await weeklyEntries()).toHaveLength(0);
      const view = parseContract(
        PaymentStatusResponseDto,
        await (await call(`/v1/payments/${checkout.paymentId}/status`)).json(),
        "PaymentStatusResponse",
      );
      expect(view.status).toBe(status);
      expect(view.boostStatus).toBe("VOID");
      expect(view.movement).toBeNull();
    });
  }

  test("a failed payment can never later be confirmed", async () => {
    const { body } = await createCheckout();
    const checkout = parseContract(CheckoutDto, body, "Checkout");
    const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);

    await deliverWebhook({ eventId: "evt-fail", providerPaymentId, status: "FAILED" });
    const late = await deliverWebhook({
      eventId: "evt-late-confirm",
      providerPaymentId,
      status: "CONFIRMED",
    });
    expect(await late.json()).toEqual({ received: true, outcome: "ILLEGAL_TRANSITION" });
    expect(await weeklyEntries()).toHaveLength(0);
  });

  test("an out-of-order PENDING after CONFIRMED changes nothing", async () => {
    const { body } = await createCheckout();
    const checkout = parseContract(CheckoutDto, body, "Checkout");
    const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);

    await deliverWebhook({ eventId: "evt-ok", providerPaymentId, status: "CONFIRMED" });
    const stale = await deliverWebhook({
      eventId: "evt-stale",
      providerPaymentId,
      status: "PENDING",
    });
    expect(await stale.json()).toEqual({ received: true, outcome: "ILLEGAL_TRANSITION" });

    const entries = await weeklyEntries();
    expect(entries[0]?.amountCents).toBe(5_000);
  });
});

describe("refunds", () => {
  test("a refund reverses the boost and drops the ranking", async () => {
    const { body } = await createCheckout();
    const checkout = parseContract(CheckoutDto, body, "Checkout");
    const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);

    await deliverWebhook({ eventId: "evt-conf", providerPaymentId, status: "CONFIRMED" });
    expect(await weeklyEntries()).toHaveLength(1);

    await deliverWebhook({ eventId: "evt-refund", providerPaymentId, status: "REFUNDED" });
    expect(await weeklyEntries()).toHaveLength(0);

    const view = parseContract(
      PaymentStatusResponseDto,
      await (await call(`/v1/payments/${checkout.paymentId}/status`)).json(),
      "PaymentStatusResponse",
    );
    expect(view.status).toBe("REFUNDED");
    expect(view.boostStatus).toBe("REVERSED");
  });

  test("a refund is audited", async () => {
    const { body } = await createCheckout();
    const checkout = parseContract(CheckoutDto, body, "Checkout");
    const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);
    await deliverWebhook({ eventId: "evt-c", providerPaymentId, status: "CONFIRMED" });
    await deliverWebhook({ eventId: "evt-r", providerPaymentId, status: "REFUNDED" });

    const logs = await call("/internal/admin/audit-logs", {
      headers: { "x-admin-api-secret": "integration-admin-secret-value" },
    });
    const body2 = (await logs.json()) as { entries: Array<{ action: string }> };
    expect(body2.entries.map((entry) => entry.action)).toContain("payment.refunded");
  });

  test("a refund cannot be applied twice", async () => {
    const { body } = await createCheckout();
    const checkout = parseContract(CheckoutDto, body, "Checkout");
    const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);
    await deliverWebhook({ eventId: "evt-c2", providerPaymentId, status: "CONFIRMED" });
    await deliverWebhook({ eventId: "evt-r2", providerPaymentId, status: "REFUNDED" });
    const again = await deliverWebhook({
      eventId: "evt-r3",
      providerPaymentId,
      status: "REFUNDED",
    });
    expect(await again.json()).toEqual({ received: true, outcome: "ILLEGAL_TRANSITION" });
  });
});

describe("a creator who stops being eligible mid-payment", () => {
  test("the boost is voided rather than activated, and audited", async () => {
    const { body } = await createCheckout();
    const checkout = parseContract(CheckoutDto, body, "Checkout");
    const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);

    // The provider really did take the money, then the creator was removed
    // while the PIX was still in flight.
    provider.simulate(providerPaymentId, "CONFIRMED");
    await setCreatorModerationStatus(testDatabase.db, creatorId, "REMOVED");

    const webhook = await deliverWebhook({
      eventId: "evt-ineligible",
      providerPaymentId,
      status: "CONFIRMED",
    });
    expect(await webhook.json()).toEqual({ received: true, outcome: "APPLIED" });

    const view = parseContract(
      PaymentStatusResponseDto,
      await (await call(`/v1/payments/${checkout.paymentId}/status`)).json(),
      "PaymentStatusResponse",
    );
    expect(view.status).toBe("CONFIRMED");
    expect(view.boostStatus).toBe("VOID");
    expect(await weeklyEntries()).toHaveLength(0);

    const logs = await call("/internal/admin/audit-logs", {
      headers: { "x-admin-api-secret": "integration-admin-secret-value" },
    });
    const auditBody = (await logs.json()) as { entries: Array<{ action: string }> };
    expect(auditBody.entries.map((entry) => entry.action)).toContain(
      "boost.voided_ineligible_creator",
    );

    // And the money was actually sent back, not merely marked.
    expect(await provider.getPaymentStatus(providerPaymentId)).toBe("REFUNDED");
  });
});

describe("webhook authentication", () => {
  test("refuses an unsigned or wrongly signed request", async () => {
    const { body } = await createCheckout();
    const checkout = parseContract(CheckoutDto, body, "Checkout");
    const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);
    const payload = JSON.stringify({
      eventId: "evt-forged",
      providerPaymentId,
      status: "CONFIRMED",
    });

    const unsigned = await call(`/v1/webhooks/payments/${provider.name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    expect(unsigned.status).toBe(401);

    const wrongSignature = await call(`/v1/webhooks/payments/${provider.name}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [FAKE_PIX_SIGNATURE_HEADER]: "0".repeat(64),
      },
      body: payload,
    });
    expect(wrongSignature.status).toBe(401);

    // And nothing was activated by either attempt.
    expect(await weeklyEntries()).toHaveLength(0);
  });

  test("refuses a signature computed over a different body", async () => {
    const { body } = await createCheckout();
    const checkout = parseContract(CheckoutDto, body, "Checkout");
    const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);
    const honest = JSON.stringify({ eventId: "e", providerPaymentId, status: "PENDING" });
    const tampered = JSON.stringify({ eventId: "e", providerPaymentId, status: "CONFIRMED" });

    const response = await call(`/v1/webhooks/payments/${provider.name}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [FAKE_PIX_SIGNATURE_HEADER]: provider.sign(honest),
      },
      body: tampered,
    });
    expect(response.status).toBe(401);
    expect(await weeklyEntries()).toHaveLength(0);
  });

  test("answers 404 for an unknown provider", async () => {
    const response = await call("/v1/webhooks/payments/nao-existe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(404);
  });

  test("acknowledges an event for a payment it does not know", async () => {
    const response = await deliverWebhook({
      eventId: "evt-unknown",
      providerPaymentId: "fake_00000000-0000-4000-8000-000000000000",
      status: "CONFIRMED",
    });
    expect(await response.json()).toEqual({ received: true, outcome: "UNKNOWN_PAYMENT" });
  });
});
