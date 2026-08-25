import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PRODUCT_DEFAULTS } from "@creator-outdoor/config";
import {
  createTestDatabase,
  insertCategory,
  insertCreator,
  type TestDatabase,
} from "@creator-outdoor/testkit";
import { createApp } from "../../src/app";
import { type LogRecord, resetLogSink, setLogSink } from "../../src/observability/logger";
import type { ErrorTracker, TrackedError } from "../../src/observability/tracker";
import { FakePixPaymentProvider } from "../../src/payments/fake-pix";
import { RateLimiter } from "../../src/security/rate-limit";

const NOW = new Date("2026-08-19T18:30:00.000Z");

const FAN_SECRET = "um-segredo-de-identidade-de-fa-com-32-bytes";
const testDatabase: TestDatabase = await createTestDatabase();
const rateLimiter = new RateLimiter();

/**
 * Signs a payload the way the fake provider would.
 *
 * `createApp` builds its own provider from the same secret, so a signature made
 * here is one the webhook route accepts — which is what lets these tests reach
 * the outcome branches rather than being turned away at the signature check.
 */
const signer = new FakePixPaymentProvider({
  expirationMinutes: PRODUCT_DEFAULTS.fakePixExpirationMinutes,
  signingSecret: FAN_SECRET,
});
const signature = (payload: string): string => signer.sign(payload);
const reported: TrackedError[] = [];
const tracker: ErrorTracker = {
  name: "recording",
  capture: async (tracked) => {
    reported.push(tracked);
  },
};
const app = createApp({
  database: testDatabase.db,
  product: PRODUCT_DEFAULTS,
  allowedOrigins: ["http://localhost:3000"],
  adminApiSecret: "integration-admin-secret-value",
  fanIdentitySecret: FAN_SECRET,
  rateLimiter,
  errorTracker: tracker,
  now: () => NOW,
});

let records: LogRecord[] = [];

beforeEach(async () => {
  await testDatabase.truncate();
  rateLimiter.reset();
  records = [];
  reported.length = 0;
  setLogSink((record) => records.push(record));
  const category = await insertCategory(testDatabase.db, {
    slug: "musica",
    name: "Musica",
    isActive: true,
  });
  await insertCreator(testDatabase.db, {
    categoryId: category.id,
    slug: "luna-verso",
    moderationStatus: "APPROVED",
  });
});

afterEach(() => {
  resetLogSink();
});

afterAll(async () => {
  await testDatabase.close();
});

async function call(path: string, init?: RequestInit): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`, init));
}

describe("request correlation", () => {
  test("answers every request with an id a client can quote", async () => {
    const response = await call("/v1/rankings/weekly");
    const requestId = response.headers.get("x-request-id");
    expect(requestId).not.toBeNull();
    expect((requestId ?? "").length).toBeGreaterThan(8);
  });

  test("gives two requests different ids", async () => {
    const first = await call("/v1/rankings/weekly");
    const second = await call("/v1/rankings/weekly");
    expect(first.headers.get("x-request-id")).not.toBe(second.headers.get("x-request-id"));
  });

  test("keeps an upstream id, so a trace spans the whole hop", async () => {
    const response = await call("/v1/rankings/weekly", {
      headers: { "x-request-id": "edge-abc-123456" },
    });
    expect(response.headers.get("x-request-id")).toBe("edge-abc-123456");
  });

  test("refuses an upstream id that could forge a log line", async () => {
    const response = await call("/v1/rankings/weekly", {
      headers: { "x-request-id": "short" },
    });
    expect(response.headers.get("x-request-id")).not.toBe("short");
  });

  test("stamps the lines a request produces with that request's id", async () => {
    // A rejected webhook logs; that line has to be findable from the response.
    const response = await call("/v1/webhooks/payments/fake-pix", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "trace-me-123456" },
      body: JSON.stringify({ eventId: "e", providerPaymentId: "p", status: "CONFIRMED" }),
    });
    expect(response.status).toBe(401);

    const rejected = records.find((record) => record.event === "webhook_rejected");
    expect(rejected).toBeDefined();
    expect(rejected?.requestId).toBe("trace-me-123456");
  });

  test("never writes a secret into a log line", async () => {
    await call("/internal/admin/creators?status=PENDING_REVIEW", {
      headers: {
        "x-admin-api-secret": "integration-admin-secret-value",
        "x-admin-actor": "edu",
      },
    });
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("integration-admin-secret-value");
  });
});

describe("reporting a failure somebody has to act on", () => {
  /*
   * A 500 is the one outcome nobody is watching for. It is in the log, but a
   * log is a thing you read after somebody complains — so it is also reported,
   * with the request id that ties it back to every other line that request
   * produced.
   */
  const broken = createApp({
    database: testDatabase.db,
    product: PRODUCT_DEFAULTS,
    allowedOrigins: ["http://localhost:3000"],
    adminApiSecret: "integration-admin-secret-value",
    fanIdentitySecret: FAN_SECRET,
    rateLimiter,
    errorTracker: tracker,
    now: () => {
      throw new Error("o relogio quebrou");
    },
  });

  test("an unhandled failure is reported, not only logged", async () => {
    const response = await broken.handle(new Request("http://localhost/v1/rankings/weekly"));
    expect(response.status).toBe(500);

    // The report is not awaited by the handler, so give it a turn to land.
    await Promise.resolve();
    expect(reported.length).toBeGreaterThan(0);
    expect(reported[0]?.event).toBe("api_error");
  });

  test("the report names the request, so it can be found in the log", async () => {
    await broken.handle(
      new Request("http://localhost/v1/rankings/weekly", {
        headers: { "x-request-id": "req-observability-1" },
      }),
    );
    await Promise.resolve();
    expect(reported[0]?.requestId).toBe("req-observability-1");
  });

  test("the report says which route failed, and carries nothing from the request", async () => {
    await broken.handle(
      new Request("http://localhost/v1/rankings/weekly?supporterEmail=alguem@example.com", {
        headers: { cookie: "co_supporter=abc", authorization: "Bearer xyz" },
      }),
    );
    await Promise.resolve();

    const serialized = JSON.stringify(reported[0]);
    expect(reported[0]?.context?.["route"]).toBe("/v1/rankings/weekly");
    expect(serialized).not.toContain("alguem@example.com");
    expect(serialized).not.toContain("co_supporter=abc");
    expect(serialized).not.toContain("Bearer xyz");
  });

  test("a request that merely 404s is not reported as a fault", async () => {
    await app.handle(new Request("http://localhost/v1/nao-existe"));
    await Promise.resolve();
    expect(reported).toEqual([]);
  });

  test("a request that fails validation is not reported as a fault", async () => {
    await app.handle(
      new Request("http://localhost/v1/boosts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nada: true }),
      }),
    );
    await Promise.resolve();
    expect(reported).toEqual([]);
  });
});

describe("a webhook that changed nothing", () => {
  /*
   * The answer is always 200, because a provider that gets anything else
   * retries forever. That makes the log the only signal — and if a provider id
   * ever stops matching, because of the wrong environment's credentials or a
   * changed payload key, every real payment takes this path.
   */
  test("says so, rather than being acknowledged in silence", async () => {
    const payload = JSON.stringify({
      eventId: "evt-desconhecido",
      providerPaymentId: "nao-existe-aqui",
      status: "CONFIRMED",
    });
    const response = await app.handle(
      new Request("http://localhost/v1/webhooks/payments/fake-pix", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-fake-pix-signature": signature(payload),
        },
        body: payload,
      }),
    );

    expect(await response.json()).toEqual({ received: true, outcome: "UNKNOWN_PAYMENT" });
    const line = records.find((record) => record.event === "webhook_no_effect");
    expect(line).toBeDefined();
    expect(line?.["outcome"]).toBe("UNKNOWN_PAYMENT");
  });

  test("carries nothing from the payload into the line", async () => {
    const payload = JSON.stringify({
      eventId: "evt-com-segredo",
      providerPaymentId: "pagamento-secreto-123",
      status: "CONFIRMED",
    });
    await app.handle(
      new Request("http://localhost/v1/webhooks/payments/fake-pix", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-fake-pix-signature": signature(payload),
        },
        body: payload,
      }),
    );

    const line = records.find((record) => record.event === "webhook_no_effect");
    expect(JSON.stringify(line)).not.toContain("pagamento-secreto-123");
  });
});
