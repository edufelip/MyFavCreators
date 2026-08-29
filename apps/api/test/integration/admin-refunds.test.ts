import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PRODUCT_DEFAULTS } from "@creator-outdoor/config";
import {
  AdminPaymentDto,
  AdminPaymentListDto,
  CheckoutDto,
  parseContract,
} from "@creator-outdoor/contracts";
import {
  createTestDatabase,
  insertCategory,
  insertCreator,
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
 * An operator sending money back.
 *
 * Refunds used to happen only when the platform decided one was owed. A support
 * conversation reaches a point no rule covers — a duplicate PIX, a purchase made
 * by mistake, a promotion nobody saw because of an incident here — and somebody
 * has to be able to act. This is that surface, and the point of these tests is
 * that acting on it cannot move money twice, cannot move it toward a creator,
 * and cannot happen without a name attached.
 */

const NOW = new Date("2026-08-20T12:00:00.000Z");
const FAN_SECRET = "um-segredo-de-identidade-de-fa-com-32-bytes";
const ADMIN_SECRET = "integration-admin-secret-value";
const ADMIN_HEADERS = {
  "content-type": "application/json",
  "x-admin-api-secret": ADMIN_SECRET,
  "x-admin-actor": "edu",
};

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
  adminApiSecret: ADMIN_SECRET,
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

/** A paid, live boost: the ordinary case an operator is asked to undo. */
async function confirmedPayment(slug: string, amountCents = 5_000) {
  await insertCreator(testDatabase.db, {
    categoryId,
    slug,
    displayName: slug,
    moderationStatus: "APPROVED",
  });
  const created = await call("/v1/boosts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      creatorSlug: slug,
      amountCents,
      supporterKey: `browser-${slug}-refund`,
    }),
  });
  const checkout = parseContract(CheckoutDto, await created.json(), "Checkout");
  const providerPaymentId = await providerPaymentIdFor(checkout.paymentId);

  provider.simulate(providerPaymentId, "CONFIRMED");
  const payload = JSON.stringify({
    eventId: `evt-${slug}`,
    providerPaymentId,
    status: "CONFIRMED",
  });
  await call(`/v1/webhooks/payments/${provider.name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [FAKE_PIX_SIGNATURE_HEADER]: provider.sign(payload),
    },
    body: payload,
  });

  return { paymentId: checkout.paymentId, providerPaymentId };
}

async function refund(paymentId: string, reason = "PIX duplicado, cliente pagou duas vezes") {
  return call(`/internal/admin/payments/${paymentId}/refund`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ reason }),
  });
}

async function auditEntries(action: string) {
  const rows = (await testDatabase.db.execute(
    `select actor, metadata from audit_logs where action = '${action}'` as never,
  )) as Array<Record<string, unknown>>;
  return rows;
}

describe("the payment ledger", () => {
  test("lists payments with the boost and creator they belong to", async () => {
    await confirmedPayment("ana", 7_500);

    const response = await call("/internal/admin/payments", { headers: ADMIN_HEADERS });
    expect(response.status).toBe(200);
    const body = parseContract(AdminPaymentListDto, await response.json(), "AdminPaymentList");

    expect(body.total).toBe(1);
    expect(body.payments[0]?.amountCents).toBe(7_500);
    expect(body.payments[0]?.status).toBe("CONFIRMED");
    expect(body.payments[0]?.boostStatus).toBe("ACTIVE");
    expect(body.payments[0]?.creatorSlug).toBe("ana");
  });

  test("filters by status", async () => {
    await confirmedPayment("ana");
    await call("/v1/boosts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        creatorSlug: "ana",
        amountCents: 3_000,
        supporterKey: "browser-ana-segunda",
      }),
    });

    const confirmed = await call("/internal/admin/payments?status=CONFIRMED", {
      headers: ADMIN_HEADERS,
    });
    const body = parseContract(AdminPaymentListDto, await confirmed.json(), "AdminPaymentList");
    expect(body.total).toBe(1);
    expect(body.payments.every((payment) => payment.status === "CONFIRMED")).toBe(true);
  });

  test("never carries a supporter identity or a provider payload", async () => {
    await confirmedPayment("ana");
    const response = await call("/internal/admin/payments", { headers: ADMIN_HEADERS });
    const raw = await response.text();

    expect(raw).not.toContain("supporter");
    expect(raw).not.toContain("@");
    expect(raw).not.toContain("qrCode");
    expect(raw).not.toContain("payload");
  });

  test("reads one payment by id, and 404s for an unknown one", async () => {
    const { paymentId } = await confirmedPayment("ana");

    const found = await call(`/internal/admin/payments/${paymentId}`, { headers: ADMIN_HEADERS });
    expect(found.status).toBe(200);
    const payment = parseContract(AdminPaymentDto, await found.json(), "AdminPayment");
    expect(payment.id).toBe(paymentId);

    const missing = await call("/internal/admin/payments/6f1d3e0e-0000-4000-8000-000000000000", {
      headers: ADMIN_HEADERS,
    });
    expect(missing.status).toBe(404);
  });
});

describe("refunding on an operator's instruction", () => {
  test("sends the money back and reverses the boost", async () => {
    const { paymentId } = await confirmedPayment("ana");

    const response = await refund(paymentId);
    expect(response.status).toBe(200);

    const after = await call(`/internal/admin/payments/${paymentId}`, { headers: ADMIN_HEADERS });
    const payment = parseContract(AdminPaymentDto, await after.json(), "AdminPayment");
    expect(payment.status).toBe("REFUNDED");
    expect(payment.refundedAt).not.toBeNull();
    expect(payment.boostStatus).toBe("REVERSED");
  });

  test("tells the provider, so the money actually moves", async () => {
    const { paymentId, providerPaymentId } = await confirmedPayment("ana");
    await refund(paymentId);
    expect(await provider.getPaymentStatus(providerPaymentId)).toBe("REFUNDED");
  });

  test("records who did it and why", async () => {
    const { paymentId } = await confirmedPayment("ana");
    await refund(paymentId, "cobranca em duplicidade confirmada pelo suporte");

    const entries = await auditEntries("payment.refunded_by_operator");
    expect(entries.length).toBe(1);
    expect(entries[0]?.["actor"]).toBe("edu");
    expect(JSON.stringify(entries[0]?.["metadata"])).toContain("duplicidade");
  });

  test("a repeated instruction does not send the money twice", async () => {
    const { paymentId } = await confirmedPayment("ana");

    const first = await refund(paymentId);
    const second = await refund(paymentId);
    expect(first.status).toBe(200);
    // Not an error: the money is back, which is what was asked for.
    expect(second.status).toBe(200);

    const events = (await testDatabase.db.execute(
      `select count(*)::int as total from payment_events
       where payload::text like '%admin%'` as never,
    )) as Array<Record<string, unknown>>;
    expect(events[0]?.["total"]).toBe(1);
  });

  test("refuses a payment that never confirmed", async () => {
    await insertCreator(testDatabase.db, {
      categoryId,
      slug: "bea",
      displayName: "Bea",
      moderationStatus: "APPROVED",
    });
    const created = await call("/v1/boosts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        creatorSlug: "bea",
        amountCents: 5_000,
        supporterKey: "browser-bea-pendente",
      }),
    });
    const checkout = parseContract(CheckoutDto, await created.json(), "Checkout");

    const response = await refund(checkout.paymentId);
    expect(response.status).toBe(422);
  });

  test("404s for a payment that does not exist", async () => {
    const response = await refund("6f1d3e0e-0000-4000-8000-000000000000");
    expect(response.status).toBe(404);
  });

  test("requires a reason, because nothing else records why", async () => {
    const { paymentId } = await confirmedPayment("ana");
    for (const reason of ["", "  ", "no"]) {
      const response = await call(`/internal/admin/payments/${paymentId}/refund`, {
        method: "POST",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ reason }),
      });
      // The contract refuses it before the handler runs, so no money moves.
      expect(response.status, reason).toBe(400);
    }

    const after = await call(`/internal/admin/payments/${paymentId}`, { headers: ADMIN_HEADERS });
    const payment = parseContract(AdminPaymentDto, await after.json(), "AdminPayment");
    expect(payment.status).toBe("CONFIRMED");
  });
});

describe("who is allowed to do this", () => {
  test("the shared secret alone is not enough — the call must name an operator", async () => {
    const { paymentId } = await confirmedPayment("ana");

    const response = await call(`/internal/admin/payments/${paymentId}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-api-secret": ADMIN_SECRET },
      body: JSON.stringify({ reason: "sem operador" }),
    });
    expect(response.status).toBe(401);

    const after = await call(`/internal/admin/payments/${paymentId}`, { headers: ADMIN_HEADERS });
    const payment = parseContract(AdminPaymentDto, await after.json(), "AdminPayment");
    expect(payment.status).toBe("CONFIRMED");
  });

  test("refuses an operator name that could never have been enrolled", async () => {
    const { paymentId } = await confirmedPayment("ana");
    for (const actor of ["", "Edu", "edu silva", "e", "a".repeat(40), "../../root"]) {
      const response = await call(`/internal/admin/payments/${paymentId}/refund`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-api-secret": ADMIN_SECRET,
          "x-admin-actor": actor,
        },
        body: JSON.stringify({ reason: "nome invalido" }),
      });
      expect(response.status, actor).toBe(401);
    }
  });

  test("an operator name without the secret changes nothing", async () => {
    const { paymentId } = await confirmedPayment("ana");
    const response = await call(`/internal/admin/payments/${paymentId}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-actor": "edu" },
      body: JSON.stringify({ reason: "sem segredo" }),
    });
    expect(response.status).toBe(401);
  });

  test("the ledger itself is closed to an unnamed caller", async () => {
    const response = await call("/internal/admin/payments", {
      headers: { "x-admin-api-secret": ADMIN_SECRET },
    });
    expect(response.status).toBe(401);
  });
});

describe("what a refund is not", () => {
  test("no money is ever recorded as moving toward a creator", async () => {
    const { paymentId } = await confirmedPayment("ana");
    await refund(paymentId);

    const entries = await auditEntries("payment.refunded_by_operator");
    const recorded = JSON.stringify(entries);
    for (const forbidden of ["repasse", "payout", "saldo", "balance", "withdraw"]) {
      expect(recorded.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  test("the creator's own row is untouched by a refund", async () => {
    const { paymentId } = await confirmedPayment("ana");
    const before = (await testDatabase.db.execute(
      `select updated_at from creators where slug = 'ana'` as never,
    )) as Array<Record<string, unknown>>;

    await refund(paymentId);

    const after = (await testDatabase.db.execute(
      `select updated_at from creators where slug = 'ana'` as never,
    )) as Array<Record<string, unknown>>;
    expect(String(after[0]?.["updated_at"])).toBe(String(before[0]?.["updated_at"]));
  });
});

/** A provider that accepts the instruction and never answers. */
function swallowsRefunds(inner: PixPaymentProvider): PixPaymentProvider {
  return {
    name: inner.name,
    createPixPayment: (input: CreatePixPaymentInput): Promise<CreatedPixPayment> =>
      inner.createPixPayment(input),
    getPaymentStatus: (id: string) => inner.getPaymentStatus(id),
    validateWebhook: (request: Request): Promise<ValidatedPaymentEvent> =>
      inner.validateWebhook(request),
    refundPayment: async (id: string) => {
      // The money really does move; only the answer is lost.
      await inner.refundPayment(id);
      throw new PaymentProviderError("the answer never came back");
    },
  };
}

/** A provider that cannot be reached at all. */
function unreachable(inner: PixPaymentProvider): PixPaymentProvider {
  return {
    name: inner.name,
    createPixPayment: (input: CreatePixPaymentInput): Promise<CreatedPixPayment> =>
      inner.createPixPayment(input),
    getPaymentStatus: () => Promise.reject(new PaymentProviderError("no route to provider")),
    validateWebhook: (request: Request): Promise<ValidatedPaymentEvent> =>
      inner.validateWebhook(request),
    refundPayment: () => Promise.reject(new PaymentProviderError("no route to provider")),
  };
}

function appWith(target: PixPaymentProvider) {
  return createApp({
    database: testDatabase.db,
    product: PRODUCT_DEFAULTS,
    allowedOrigins: ["http://localhost:3000"],
    adminApiSecret: ADMIN_SECRET,
    fanIdentitySecret: FAN_SECRET,
    paymentProvider: target,
    rateLimiter,
    now: () => NOW,
  });
}

async function auditActions(paymentId: string): Promise<string[]> {
  const rows = (await testDatabase.db.execute(
    `select action from audit_logs where target_type = 'payment' and target_id = '${paymentId}'
     order by created_at asc` as never,
  )) as Array<Record<string, unknown>>;
  return rows.map((row) => String(row["action"]));
}

describe("when the provider does not answer", () => {
  test("a provider that cannot be reached is reported as nothing attempted", async () => {
    const { paymentId } = await confirmedPayment("ana");

    const response = await appWith(unreachable(provider)).handle(
      new Request(`http://localhost/internal/admin/payments/${paymentId}/refund`, {
        method: "POST",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ reason: "provedor fora do ar" }),
      }),
    );

    expect(response.status).toBe(502);
    const body: unknown = await response.json();
    expect(JSON.stringify(body)).toContain("Nada foi alterado");
    expect(await auditActions(paymentId)).toContain("payment.refund_not_attempted");
  });

  test("an instruction whose answer was lost does not claim nothing changed", async () => {
    /*
     * The dangerous case. Told "nothing changed", an operator refunds again;
     * told "done", they close the ticket on money that may still be here.
     */
    const { paymentId } = await confirmedPayment("ana");

    const response = await appWith(swallowsRefunds(provider)).handle(
      new Request(`http://localhost/internal/admin/payments/${paymentId}/refund`, {
        method: "POST",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ reason: "timeout no provedor" }),
      }),
    );

    expect(response.status).toBe(502);
    const body: unknown = await response.json();
    expect(JSON.stringify(body)).not.toContain("Nada foi alterado");
    expect(JSON.stringify(body)).toContain("Verifique");
    /*
     * `attempted`, not `uncertain`. The marker is written before the provider
     * is called, so it means "we asked" — a fact that is true whatever comes
     * back — rather than "we do not know", which only one of the three
     * outcomes could ever claim.
     */
    expect(await auditActions(paymentId)).toContain("payment.refund_attempted");
  });

  test("the sweep finds the money the lost answer left behind", async () => {
    /*
     * The boost here is ACTIVE — the promotion really ran — so the owed-refund
     * query used to skip it entirely: CONFIRMED, so the unsettled sweep ignored
     * it, and not VOID, so nothing else looked. The money simply stayed.
     */
    const { paymentId, providerPaymentId } = await confirmedPayment("ana");

    await appWith(swallowsRefunds(provider)).handle(
      new Request(`http://localhost/internal/admin/payments/${paymentId}/refund`, {
        method: "POST",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ reason: "timeout no provedor" }),
      }),
    );

    // The provider took it; our record still says CONFIRMED.
    expect(await provider.getPaymentStatus(providerPaymentId)).toBe("REFUNDED");
    const before = await call(`/internal/admin/payments/${paymentId}`, { headers: ADMIN_HEADERS });
    expect(parseContract(AdminPaymentDto, await before.json(), "AdminPayment").status).toBe(
      "CONFIRMED",
    );

    const summary = await reconcilePayments(testDatabase.db, PRODUCT_DEFAULTS, provider, {
      now: NOW,
    });
    expect(summary.refunded).toBe(1);

    const after = await call(`/internal/admin/payments/${paymentId}`, { headers: ADMIN_HEADERS });
    const settled = parseContract(AdminPaymentDto, await after.json(), "AdminPayment");
    expect(settled.status).toBe("REFUNDED");
    expect(settled.refundedAt).not.toBeNull();
  });

  test("a refund that moved money and then lost the write is still findable", async () => {
    /*
     * The window the marker used to miss entirely. `refundPayment` succeeds and
     * the write that records it throws — a failover, a pool timeout, a lock wait
     * behind a webhook — so the money is gone, the payment is CONFIRMED, the
     * boost is still scoring, and, when the marker was only written in the
     * failure path, nothing anywhere said an attempt had been made.
     *
     * Simulated by refunding at the provider directly and writing only the
     * marker, which is exactly the state that crash leaves behind.
     */
    const { paymentId, providerPaymentId } = await confirmedPayment("ana");
    await provider.refundPayment(providerPaymentId);
    await testDatabase.db.execute(
      `insert into audit_logs (actor, action, target_type, target_id, metadata)
       values ('edu', 'payment.refund_attempted', 'payment', '${paymentId}', '{}'::jsonb)` as never,
    );

    const summary = await reconcilePayments(testDatabase.db, PRODUCT_DEFAULTS, provider, {
      now: NOW,
    });
    expect(summary.refunded).toBe(1);

    const after = await call(`/internal/admin/payments/${paymentId}`, { headers: ADMIN_HEADERS });
    expect(parseContract(AdminPaymentDto, await after.json(), "AdminPayment").status).toBe(
      "REFUNDED",
    );
  });

  test("an ordered refund the provider never took is sent by the sweep", async () => {
    /*
     * The half of the marker's meaning that nothing else covers. The other
     * tests all leave the money already gone at the provider; here the
     * instruction was recorded and then genuinely never left — a `refundPayment`
     * that threw before it reached anyone.
     *
     * The sweep sends it. That is the decision rather than an accident (ADR
     * 0015): an operator ordered this refund, so a marker whose refund never
     * left is a job half done, not a false alarm. It is also why the runbook
     * says the button cannot be un-pressed, and this test is what would fail if
     * somebody made the sweep "safer" by only recording what it finds.
     */
    const { paymentId, providerPaymentId } = await confirmedPayment("ana");
    await testDatabase.db.execute(
      `insert into audit_logs (actor, action, target_type, target_id, metadata)
       values ('edu', 'payment.refund_attempted', 'payment', '${paymentId}', '{}'::jsonb)` as never,
    );
    // Nothing moved: the provider still holds it.
    expect(await provider.getPaymentStatus(providerPaymentId)).toBe("CONFIRMED");

    const summary = await reconcilePayments(testDatabase.db, PRODUCT_DEFAULTS, provider, {
      now: NOW,
    });
    expect(summary.refunded).toBe(1);
    expect(await provider.getPaymentStatus(providerPaymentId)).toBe("REFUNDED");

    const after = await call(`/internal/admin/payments/${paymentId}`, { headers: ADMIN_HEADERS });
    expect(parseContract(AdminPaymentDto, await after.json(), "AdminPayment").status).toBe(
      "REFUNDED",
    );
  });

  test("a settled refund is not sent a second time by a later sweep", async () => {
    // The marker stays in the audit log forever, so the guard against a second
    // refund is `refunded_at`, not the absence of a marker. A sweep that ran
    // twice on a busy hour must not move money twice.
    const { paymentId, providerPaymentId } = await confirmedPayment("ana");
    await testDatabase.db.execute(
      `insert into audit_logs (actor, action, target_type, target_id, metadata)
       values ('edu', 'payment.refund_attempted', 'payment', '${paymentId}', '{}'::jsonb)` as never,
    );

    const first = await reconcilePayments(testDatabase.db, PRODUCT_DEFAULTS, provider, {
      now: NOW,
    });
    expect(first.refunded).toBe(1);

    const second = await reconcilePayments(testDatabase.db, PRODUCT_DEFAULTS, provider, {
      now: NOW,
    });
    expect(second.examined).toBe(0);
    expect(second.refunded).toBe(0);
    expect(await provider.getPaymentStatus(providerPaymentId)).toBe("REFUNDED");
  });

  test("a payment nobody flagged is left alone by the sweep", async () => {
    await confirmedPayment("bea");
    const summary = await reconcilePayments(testDatabase.db, PRODUCT_DEFAULTS, provider, {
      now: NOW,
    });
    expect(summary.refunded).toBe(0);
  });
});
