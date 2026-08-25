import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PRODUCT_DEFAULTS } from "@creator-outdoor/config";
import { CheckoutDto, parseContract } from "@creator-outdoor/contracts";
import {
  createTestDatabase,
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

/**
 * Money the platform owes back.
 *
 * A boost voided because its creator stopped being eligible is money taken for
 * a promotion that was never delivered. The refund is attempted immediately —
 * and when that attempt fails, something has to try again, or the platform
 * simply keeps it.
 */

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

async function providerPaymentIdFor(paymentId: string): Promise<string> {
  const rows = (await testDatabase.db.execute(
    `select provider_payment_id from payments where id = '${paymentId}'` as never,
  )) as Array<Record<string, unknown>>;
  return String(rows[0]?.["provider_payment_id"] ?? "");
}

async function paymentRow(paymentId: string) {
  const rows = (await testDatabase.db.execute(
    `select p.status, p.refunded_at, b.status as boost_status
     from payments p join boosts b on b.payment_id = p.id
     where p.id = '${paymentId}'` as never,
  )) as Array<Record<string, unknown>>;
  const row = rows[0];
  return {
    status: String(row?.["status"]),
    boostStatus: String(row?.["boost_status"]),
    refunded: row?.["refunded_at"] !== null && row?.["refunded_at"] !== undefined,
  };
}

/** A refund the platform owes: creator went dark while the PIX was in flight. */
async function owedRefund(slug: string, options: { readonly refundFails: boolean }) {
  const creator = await insertCreator(testDatabase.db, {
    categoryId,
    slug,
    displayName: slug,
    moderationStatus: "APPROVED",
  });
  const response = await call("/v1/boosts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      creatorSlug: slug,
      amountCents: 5_000,
      supporterKey: `browser-${slug}-boost`,
    }),
  });
  const checkout = parseContract(CheckoutDto, await response.json(), "Checkout");
  const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);

  await setCreatorModerationStatus(testDatabase.db, creator.id, "REMOVED");

  // The money really did settle at the provider; that is why we owe it back.
  provider.simulate(providerPaymentId, "CONFIRMED");

  const payload = JSON.stringify({
    eventId: `evt-${slug}`,
    providerPaymentId,
    status: "CONFIRMED",
  });
  const target = options.refundFails ? refusesRefunds(provider) : provider;
  const scoped = createApp({
    database: testDatabase.db,
    product: PRODUCT_DEFAULTS,
    allowedOrigins: ["http://localhost:3000"],
    adminApiSecret: "integration-admin-secret-value",
    fanIdentitySecret: FAN_SECRET,
    paymentProvider: target,
    rateLimiter,
    now: () => NOW,
  });
  await scoped.handle(
    new Request(`http://localhost/v1/webhooks/payments/${provider.name}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [FAKE_PIX_SIGNATURE_HEADER]: provider.sign(payload),
      },
      body: payload,
    }),
  );

  return { paymentId: checkout.paymentId, providerPaymentId };
}

/** The provider is up, but every refund call fails. */
function refusesRefunds(inner: PixPaymentProvider): PixPaymentProvider {
  return {
    name: inner.name,
    createPixPayment: (input: CreatePixPaymentInput): Promise<CreatedPixPayment> =>
      inner.createPixPayment(input),
    getPaymentStatus: (id: string) => inner.getPaymentStatus(id),
    validateWebhook: (request: Request): Promise<ValidatedPaymentEvent> =>
      inner.validateWebhook(request),
    refundPayment: () => Promise.reject(new PaymentProviderError("refunds are down")),
  };
}

function reconcile(using: PixPaymentProvider = provider) {
  return reconcilePayments(testDatabase.db, PRODUCT_DEFAULTS, using, { now: NOW });
}

describe("a refund the platform owes but could not make", () => {
  test("is retried until it succeeds, rather than kept", async () => {
    const { paymentId, providerPaymentId } = await owedRefund("saiu-do-ar", { refundFails: true });

    // The boost was voided, but the money is still ours: the refund call failed.
    const stranded = await paymentRow(paymentId);
    expect(stranded.status).toBe("CONFIRMED");
    expect(stranded.boostStatus).toBe("VOID");
    expect(await provider.getPaymentStatus(providerPaymentId)).toBe("CONFIRMED");

    const summary = await reconcile();
    expect(summary.refunded).toBe(1);

    expect(await provider.getPaymentStatus(providerPaymentId)).toBe("REFUNDED");
    const settled = await paymentRow(paymentId);
    expect(settled.status).toBe("REFUNDED");
    expect(settled.refunded).toBe(true);
    // The boost stays VOID. REVERSED means "the promotion was live and was
    // undone", and this one never ran a second: the creator was already
    // ineligible when the money arrived. The refund is a fact about the
    // payment, and dragging the boost into a status that misdescribes what the
    // public saw would make the record less true, not more.
    expect(settled.boostStatus).toBe("VOID");
  });

  test("records the refused boost transition rather than performing it", async () => {
    const { paymentId } = await owedRefund("recusa-registrada", { refundFails: true });
    await reconcile();

    const rows = (await testDatabase.db.execute(
      `select metadata from audit_logs where action = 'boost.transition_refused'` as never,
    )) as Array<Record<string, unknown>>;

    // The guard is not silent. An operator reading the log can see that the
    // payment reached REFUNDED and that the boost deliberately did not follow
    // it, which is the difference between an enforced rule and a missing one.
    expect(rows.length).toBe(1);
    const metadata = JSON.stringify(rows[0]?.["metadata"]);
    expect(metadata).toContain("VOID");
    expect(metadata).toContain("REVERSED");
    expect(metadata).toContain(paymentId);
  });

  test("is not attempted twice once it has been made", async () => {
    await owedRefund("uma-vez-so", { refundFails: true });
    expect((await reconcile()).refunded).toBe(1);

    // Nothing is owed any more, so there is nothing to find.
    expect((await reconcile()).refunded).toBe(0);
  });

  test("stays owed when the provider is still refusing", async () => {
    const { paymentId } = await owedRefund("ainda-fora", { refundFails: true });

    const summary = await reconcile(refusesRefunds(provider));
    expect(summary.refunded).toBe(0);
    expect(summary.failed).toBe(1);

    // Still owed, so the next run will try again.
    expect((await paymentRow(paymentId)).status).toBe("CONFIRMED");
    expect((await reconcile()).refunded).toBe(1);
  });

  test("records a refund the provider already made without asking twice", async () => {
    // A crash between the provider call and the write leaves exactly this.
    const { paymentId, providerPaymentId } = await owedRefund("ja-devolvido", {
      refundFails: true,
    });
    provider.simulate(providerPaymentId, "REFUNDED");

    expect((await reconcile()).refunded).toBe(1);
    expect((await paymentRow(paymentId)).status).toBe("REFUNDED");
  });

  test("leaves an ordinary confirmed boost alone", async () => {
    const creator = await insertCreator(testDatabase.db, {
      categoryId,
      slug: "tudo-certo",
      moderationStatus: "APPROVED",
    });
    const response = await call("/v1/boosts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        creatorSlug: creator.slug,
        amountCents: 5_000,
        supporterKey: "browser-tudo-certo",
      }),
    });
    const checkout = parseContract(CheckoutDto, await response.json(), "Checkout");
    const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);
    const payload = JSON.stringify({ eventId: "evt-ok", providerPaymentId, status: "CONFIRMED" });
    await call(`/v1/webhooks/payments/${provider.name}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [FAKE_PIX_SIGNATURE_HEADER]: provider.sign(payload),
      },
      body: payload,
    });

    expect((await reconcile()).refunded).toBe(0);
    const row = await paymentRow(checkout.paymentId);
    expect(row.status).toBe("CONFIRMED");
    expect(row.boostStatus).toBe("ACTIVE");
  });
});
