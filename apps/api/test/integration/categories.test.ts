import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PRODUCT_DEFAULTS } from "@creator-outdoor/config";
import { CategoryListDto, parseContract } from "@creator-outdoor/contracts";
import { createTestDatabase, insertCategory, type TestDatabase } from "@creator-outdoor/testkit";
import { createApp } from "../../src/app";
import { RateLimiter } from "../../src/security/rate-limit";

/**
 * The categories a visitor can browse.
 *
 * Public and unauthenticated, so the rule is the same as every other public
 * read: it shows what is live and nothing about how the platform is run.
 */
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

beforeEach(async () => {
  await testDatabase.truncate();
  rateLimiter.reset();
});

afterAll(async () => {
  await testDatabase.close();
});

async function call(path: string): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`));
}

describe("listing categories", () => {
  test("returns the live ones, by name", async () => {
    await insertCategory(testDatabase.db, { slug: "musica", name: "Musica", isActive: true });
    await insertCategory(testDatabase.db, { slug: "arte", name: "Arte", isActive: true });

    const response = await call("/v1/categories");
    expect(response.status).toBe(200);
    const body = parseContract(CategoryListDto, await response.json(), "CategoryList");

    expect(body.categories.map((category) => category.slug)).toEqual(["arte", "musica"]);
  });

  test("never shows one that is switched off", async () => {
    await insertCategory(testDatabase.db, { slug: "musica", name: "Musica", isActive: true });
    await insertCategory(testDatabase.db, { slug: "oculta", name: "Oculta", isActive: false });

    const response = await call("/v1/categories");
    const body = parseContract(CategoryListDto, await response.json(), "CategoryList");
    expect(body.categories.map((category) => category.slug)).toEqual(["musica"]);
  });

  test("is an empty list rather than an error when there are none", async () => {
    const response = await call("/v1/categories");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ categories: [] });
  });

  test("carries nothing but the slug and the name", async () => {
    await insertCategory(testDatabase.db, { slug: "musica", name: "Musica", isActive: true });
    const response = await call("/v1/categories");
    const payload: unknown = await response.json();

    // No database id, no isActive flag: an internal identifier on a public
    // endpoint is an internal identifier somebody will start depending on.
    expect(JSON.stringify(payload)).not.toContain("isActive");
    expect(JSON.stringify(payload)).not.toContain('"id"');
  });
});
