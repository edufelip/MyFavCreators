import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PRODUCT_DEFAULTS } from "@creator-outdoor/config";
import {
  CheckoutDto,
  LeaderboardResponseDto,
  PaymentStatusResponseDto,
  parseContract,
  RankEventListDto,
} from "@creator-outdoor/contracts";
import type { PaymentStatus } from "@creator-outdoor/domain";
import {
  createTestDatabase,
  insertBoost,
  insertCategory,
  insertCreator,
  setCreatorModerationStatus,
  type TestDatabase,
} from "@creator-outdoor/testkit";
import { createApp } from "../../src/app";
import { FAKE_PIX_SIGNATURE_HEADER, FakePixPaymentProvider } from "../../src/payments/fake-pix";
import {
  type CreatedPixPayment,
  type CreatePixPaymentInput,
  PaymentProviderError,
  type PixPaymentProvider,
  type ValidatedPaymentEvent,
} from "../../src/payments/provider";
import { RateLimiter } from "../../src/security/rate-limit";
import { reconcilePayments } from "../../src/services/reconciliation";

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

let categoryId = "";

beforeEach(async () => {
  await testDatabase.truncate();
  rateLimiter.reset();
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

async function call(path: string, init?: RequestInit): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`, init));
}

/**
 * Opens a real checkout through the API, so the payment row under test is the
 * one production writes rather than a fixture shaped to suit the assertion.
 */
async function openCheckout(
  slug: string,
  amountCents = 5_000,
): Promise<{
  readonly paymentId: string;
  readonly providerPaymentId: string;
  readonly creatorId: string;
}> {
  const creator = await insertCreator(testDatabase.db, {
    categoryId,
    slug,
    displayName: slug,
    moderationStatus: "APPROVED",
  });
  return { ...(await boostFor(slug, amountCents)), creatorId: creator.id };
}

/** A further checkout for a creator who already exists. */
async function boostFor(
  slug: string,
  amountCents: number,
): Promise<{ readonly paymentId: string; readonly providerPaymentId: string }> {
  const response = await call("/v1/boosts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      creatorSlug: slug,
      amountCents,
      supporterKey: `browser-${slug}-${amountCents}`,
    }),
  });
  const checkout = parseContract(CheckoutDto, await response.json(), "Checkout");
  return {
    paymentId: checkout.paymentId,
    providerPaymentId: await providerPaymentIdFor(checkout.paymentId),
  };
}

async function providerPaymentIdFor(paymentId: string): Promise<string> {
  const rows = await testDatabase.db.execute(
    `select provider_payment_id from payments where id = '${paymentId}'` as never,
  );
  const row = (rows as Array<Record<string, unknown>>)[0];
  return String(row?.["provider_payment_id"] ?? "");
}

/**
 * Backdates every payment so the reconciler's staleness filter lets it through.
 * Wall-clock waiting has no place in a test suite.
 */
async function backdatePayments(minutes = 60): Promise<void> {
  const at = new Date(NOW.getTime() - minutes * 60_000).toISOString();
  await testDatabase.db.execute(`update payments set updated_at = '${at}'` as never);
}

async function reconcile(
  using: PixPaymentProvider = provider,
): Promise<Awaited<ReturnType<typeof reconcilePayments>>> {
  return reconcilePayments(testDatabase.db, PRODUCT_DEFAULTS, using, { now: NOW });
}

async function paymentView(paymentId: string) {
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

async function tickerEvents() {
  const payload = parseContract(
    RankEventListDto,
    await (await call("/v1/rank-events")).json(),
    "RankEventList",
  );
  return payload.events;
}

/** Wraps the fake provider so a single payment can be made to fail on demand. */
class FailingForOneProvider implements PixPaymentProvider {
  readonly name: string;

  constructor(
    private readonly inner: PixPaymentProvider,
    private readonly failFor: string,
  ) {
    this.name = inner.name;
  }

  createPixPayment(input: CreatePixPaymentInput): Promise<CreatedPixPayment> {
    return this.inner.createPixPayment(input);
  }

  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus> {
    if (providerPaymentId === this.failFor) {
      return Promise.reject(new PaymentProviderError("provider is having a bad day"));
    }
    return this.inner.getPaymentStatus(providerPaymentId);
  }

  validateWebhook(request: Request): Promise<ValidatedPaymentEvent> {
    return this.inner.validateWebhook(request);
  }

  refundPayment(providerPaymentId: string): Promise<void> {
    return this.inner.refundPayment(providerPaymentId);
  }
}

describe("recovering a payment whose webhook never arrived", () => {
  test("confirms it, activates the boost and moves the ranking", async () => {
    const { paymentId, providerPaymentId } = await openCheckout("luna-verso");
    // The customer paid; the provider knows. The webhook was lost in transit.
    provider.simulate(providerPaymentId, "CONFIRMED");
    expect((await paymentView(paymentId)).status).toBe("PENDING");
    expect(await weeklyEntries()).toHaveLength(0);

    await backdatePayments();
    const summary = await reconcile();

    expect(summary).toEqual({ examined: 1, changed: 1, unchanged: 0, failed: 0, refunded: 0 });
    const view = await paymentView(paymentId);
    expect(view.status).toBe("CONFIRMED");
    expect(view.boostStatus).toBe("ACTIVE");
    const entries = await weeklyEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.creator.slug).toBe("luna-verso");
    expect(entries[0]?.amountCents).toBe(5_000);
  });

  test("records the overtake the lost webhook would have recorded", async () => {
    // A recovered payment has to produce the same public consequences as a
    // delivered one, ticker line included, or the billboard silently forgets
    // that someone took the lead.
    const leader = await openCheckout("primeiro-lugar", 5_000);
    const challenger = await openCheckout("desafiante", 3_000);
    provider.simulate(leader.providerPaymentId, "CONFIRMED");
    provider.simulate(challenger.providerPaymentId, "CONFIRMED");
    await backdatePayments();
    await reconcile();
    // Entering the ranking is not an overtake, so nothing has happened yet.
    expect(await tickerEvents()).toHaveLength(0);

    // Now the second-placed creator is pushed past the leader by a boost whose
    // webhook is lost exactly like the others.
    const pass = await boostFor("desafiante", 3_000);
    provider.simulate(pass.providerPaymentId, "CONFIRMED");
    await backdatePayments();
    await reconcile();

    const events = await tickerEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.creatorSlug).toBe("desafiante");
    expect(events[0]?.fromRank).toBe(2);
    expect(events[0]?.toRank).toBe(1);
  });

  test("running twice at once confirms it exactly once", async () => {
    const { paymentId, providerPaymentId } = await openCheckout("corrida");
    provider.simulate(providerPaymentId, "CONFIRMED");
    await backdatePayments();

    // Two schedulers firing the job together, or one container restarting
    // mid-run. Both read the same candidate before either writes.
    let waiting = 0;
    let release = (): void => {};
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gated: PixPaymentProvider = {
      name: provider.name,
      createPixPayment: (input) => provider.createPixPayment(input),
      getPaymentStatus: async (id) => {
        waiting += 1;
        if (waiting === 2) {
          release();
        }
        await bothArrived;
        return provider.getPaymentStatus(id);
      },
      validateWebhook: (request) => provider.validateWebhook(request),
      refundPayment: (id) => provider.refundPayment(id),
    };

    const [first, second] = await Promise.all([reconcile(gated), reconcile(gated)]);

    expect(first.examined).toBe(1);
    expect(second.examined).toBe(1);
    // One applied the event; the other lost the fingerprint claim and changed
    // nothing. The score is charged once, never twice.
    expect(first.changed + second.changed).toBe(1);
    expect(first.unchanged + second.unchanged).toBe(1);
    expect(first.failed + second.failed).toBe(0);
    expect((await paymentView(paymentId)).status).toBe("CONFIRMED");
    const entries = await weeklyEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.amountCents).toBe(5_000);
  });

  test("the delayed webhook arriving afterwards changes nothing", async () => {
    const { paymentId, providerPaymentId } = await openCheckout("atrasado");
    provider.simulate(providerPaymentId, "CONFIRMED");
    await backdatePayments();
    await reconcile();

    // The provider finally retries the delivery it could not complete.
    const body = JSON.stringify({
      eventId: "evt-finally-delivered",
      providerPaymentId,
      status: "CONFIRMED",
    });
    const response = await call(`/v1/webhooks/payments/${provider.name}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [FAKE_PIX_SIGNATURE_HEADER]: provider.sign(body),
      },
      body,
    });

    // Acknowledged so the provider stops retrying, but it moves nothing:
    // CONFIRMED is not a legal move from CONFIRMED.
    expect(await response.json()).toEqual({ received: true, outcome: "ILLEGAL_TRANSITION" });
    expect((await paymentView(paymentId)).status).toBe("CONFIRMED");
    const entries = await weeklyEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.amountCents).toBe(5_000);
  });

  test("records an expiry the provider reports", async () => {
    const { paymentId, providerPaymentId } = await openCheckout("desistiu");
    provider.simulate(providerPaymentId, "EXPIRED");
    await backdatePayments();

    expect(await reconcile()).toEqual({
      examined: 1,
      changed: 1,
      unchanged: 0,
      failed: 0,
      refunded: 0,
    });
    const view = await paymentView(paymentId);
    expect(view.status).toBe("EXPIRED");
    expect(view.boostStatus).toBe("VOID");
    expect(await weeklyEntries()).toHaveLength(0);
  });
});

describe("what reconciliation refuses to touch", () => {
  test("leaves a payment the provider still calls pending", async () => {
    const { paymentId } = await openCheckout("ainda-pagando");
    await backdatePayments();

    expect(await reconcile()).toEqual({
      examined: 1,
      changed: 0,
      unchanged: 1,
      failed: 0,
      refunded: 0,
    });
    expect((await paymentView(paymentId)).status).toBe("PENDING");
    expect(await weeklyEntries()).toHaveLength(0);
  });

  test("ignores a checkout the customer only just opened", async () => {
    // A payment seconds old is not stuck, it is in progress. Asking the
    // provider about every fresh checkout would be a self-inflicted load test.
    const { providerPaymentId } = await openCheckout("recem-aberto");
    provider.simulate(providerPaymentId, "CONFIRMED");

    expect(await reconcile()).toEqual({
      examined: 0,
      changed: 0,
      unchanged: 0,
      failed: 0,
      refunded: 0,
    });
    expect(await weeklyEntries()).toHaveLength(0);
  });

  test("ignores payments belonging to another provider", async () => {
    const creator = await insertCreator(testDatabase.db, {
      categoryId,
      slug: "outro-gateway",
      moderationStatus: "APPROVED",
    });
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 5_000,
      paymentStatus: "PENDING",
      boostStatus: "PENDING",
    });
    await backdatePayments();

    // The fixture writes provider "test"; this job speaks only for its own.
    expect(await reconcile()).toEqual({
      examined: 0,
      changed: 0,
      unchanged: 0,
      failed: 0,
      refunded: 0,
    });
  });

  test("leaves a settled payment alone", async () => {
    const { paymentId, providerPaymentId } = await openCheckout("ja-resolvido");
    provider.simulate(providerPaymentId, "CONFIRMED");
    await backdatePayments();
    await reconcile();
    await backdatePayments();

    // Nothing left to ask about: a confirmed payment is no longer a candidate.
    expect(await reconcile()).toEqual({
      examined: 0,
      changed: 0,
      unchanged: 0,
      failed: 0,
      refunded: 0,
    });
    expect((await paymentView(paymentId)).status).toBe("CONFIRMED");
  });
});

describe("when the provider misbehaves", () => {
  test("one failure does not stop the rest of the batch", async () => {
    const broken = await openCheckout("sem-resposta");
    const healthy = await openCheckout("resposta-ok");
    provider.simulate(broken.providerPaymentId, "CONFIRMED");
    provider.simulate(healthy.providerPaymentId, "CONFIRMED");
    await backdatePayments();

    const summary = await reconcile(new FailingForOneProvider(provider, broken.providerPaymentId));

    expect(summary.examined).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.changed).toBe(1);
    expect((await paymentView(healthy.paymentId)).status).toBe("CONFIRMED");
    // The one that failed is untouched and will be retried on the next run.
    expect((await paymentView(broken.paymentId)).status).toBe("PENDING");
  });

  test("a failed payment stays a candidate for the next run", async () => {
    const { paymentId, providerPaymentId } = await openCheckout("tenta-de-novo");
    provider.simulate(providerPaymentId, "CONFIRMED");
    await backdatePayments();

    await reconcile(new FailingForOneProvider(provider, providerPaymentId));
    expect((await paymentView(paymentId)).status).toBe("PENDING");

    expect(await reconcile()).toEqual({
      examined: 1,
      changed: 1,
      unchanged: 0,
      failed: 0,
      refunded: 0,
    });
    expect((await paymentView(paymentId)).status).toBe("CONFIRMED");
  });
});

describe("a creator who stopped being eligible while the PIX was in flight", () => {
  test("takes the money back instead of promoting them", async () => {
    const { paymentId, providerPaymentId, creatorId } = await openCheckout("saiu-do-ar");
    await setCreatorModerationStatus(testDatabase.db, creatorId, "REMOVED");
    provider.simulate(providerPaymentId, "CONFIRMED");
    await backdatePayments();

    const summary = await reconcile();
    expect(summary.changed).toBe(1);
    expect(summary.refunded).toBe(1);

    /*
     * The money goes back and the record says so. The refund used to be issued
     * at the provider while our own payment stayed CONFIRMED forever — a
     * discrepancy nothing would ever have reconciled, because a CONFIRMED
     * payment is not something the unsettled sweep looks at.
     */
    const view = await paymentView(paymentId);
    expect(view.status).toBe("REFUNDED");
    expect(view.boostStatus).toBe("REVERSED");
    expect(await weeklyEntries()).toHaveLength(0);
    expect(await provider.getPaymentStatus(providerPaymentId)).toBe("REFUNDED");
  });
});
