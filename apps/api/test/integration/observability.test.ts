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
import { RateLimiter } from "../../src/security/rate-limit";

const NOW = new Date("2026-08-19T18:30:00.000Z");

const testDatabase: TestDatabase = await createTestDatabase();
const rateLimiter = new RateLimiter();
const app = createApp({
  database: testDatabase.db,
  product: PRODUCT_DEFAULTS,
  allowedOrigins: ["http://localhost:3000"],
  adminApiSecret: "integration-admin-secret-value",
  fanIdentitySecret: "um-segredo-de-identidade-de-fa-com-32-bytes",
  rateLimiter,
  now: () => NOW,
});

let records: LogRecord[] = [];

beforeEach(async () => {
  await testDatabase.truncate();
  rateLimiter.reset();
  records = [];
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
