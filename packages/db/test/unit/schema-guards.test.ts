import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "../../src/schema";

/**
 * The business rules that are easiest to break by accident are the ones about
 * what must *not* exist. A payout column added in good faith during a later
 * feature would change what this product is, and nothing in a type system would
 * complain. These tests read the schema and refuse.
 */

const SCHEMA_DIR = join(import.meta.dir, "..", "..", "src", "schema");

/**
 * The schema with its prose removed.
 *
 * Comments are where these rules are *explained* — "no payout, split or escrow
 * anywhere in this schema, by design" is a sentence that must survive a search
 * for the word it contains. What the guard is about is what the schema
 * declares, so only code is scanned.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function readSchemaFiles(exclude: readonly string[] = []): string {
  return readdirSync(SCHEMA_DIR)
    .filter((file) => file.endsWith(".ts") && !exclude.includes(file))
    .map((file) => stripComments(readFileSync(join(SCHEMA_DIR, file), "utf8")))
    .join("\n")
    .toLowerCase();
}

function schemaSource(): string {
  return readSchemaFiles();
}

describe("what the schema must never model", () => {
  test("has no creator payout, balance, withdrawal, split or escrow", () => {
    // 100% of boost revenue belongs to the platform. There is no code path for
    // money leaving it to a creator, and this is the reason there is no column.
    const source = schemaSource();
    for (const forbidden of [
      "payout",
      "balance",
      "withdraw",
      "escrow",
      "revenue_share",
      "revenueshare",
      "payment_split",
      "paymentsplit",
      "creator_wallet",
      "creatorwallet",
    ]) {
      expect(source.includes(forbidden), `schema mentions "${forbidden}"`).toBe(false);
    }
  });

  test("has no external engagement signal to rank by", () => {
    // Followers, likes and views can never affect a position if they are not
    // there to be queried in the first place.
    const source = schemaSource();
    for (const forbidden of [
      "follower",
      "subscriber_count",
      "likes",
      "watch_time",
      "watchtime",
      "view_count",
      "viewcount",
      "engagement",
    ]) {
      expect(source.includes(forbidden), `schema mentions "${forbidden}"`).toBe(false);
    }
  });

  test("stores no rank and no score", () => {
    // A rank is derived from money at read time (ADR 0002). The one exception
    // is a closed period's snapshot, which is history rather than the ranking.
    const source = readSchemaFiles(["ranking.ts"]);
    expect(source.includes('integer("rank")')).toBe(false);
    expect(source.includes('integer("score")')).toBe(false);
  });

  test("keeps every money column an integer of centavos", () => {
    const source = schemaSource();
    for (const forbidden of [
      "real(",
      "doubleprecision(",
      "double_precision",
      "numeric(",
      "float",
    ]) {
      expect(source.includes(forbidden), `schema uses "${forbidden}" for money`).toBe(false);
    }
    expect(source.includes('integer("amount_cents")')).toBe(true);
  });
});

describe("the tables that exist", () => {
  test("are exactly the ones the product needs", () => {
    // A new table is a decision worth noticing in review, not a diff to skim.
    const tables = Object.keys(schema)
      .filter((name) => !name.endsWith("Enum") && !/^[A-Z_]+$/.test(name))
      .sort();
    expect(tables).toEqual([
      "auditLogs",
      "boosts",
      "categories",
      "creatorClaims",
      "creatorLinks",
      "creatorRankingSnapshots",
      "creatorSuppressions",
      "creatorVerifications",
      "creators",
      "impressions",
      "notificationDeliveries",
      "notificationSubscriptions",
      "outboundClicks",
      "paymentEvents",
      "payments",
      "rankEvents",
      "rankingPeriods",
      "reports",
    ]);
  });
});
