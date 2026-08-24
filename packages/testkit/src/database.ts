import { applyMigrations, closeDatabase, createDatabase, type Database } from "@creator-outdoor/db";
import { sql } from "drizzle-orm";

/** Tables truncated between tests, ordered so foreign keys stay satisfied. */
const ALL_TABLES = [
  "rank_events",
  "creator_ranking_snapshots",
  "impressions",
  "outbound_clicks",
  "notification_subscriptions",
  "reports",
  "audit_logs",
  "payment_events",
  "boosts",
  "payments",
  "creator_links",
  "creator_suppressions",
  "creators",
  "ranking_periods",
  "categories",
] as const;

export type TestDatabase = {
  readonly db: Database;
  /** Empties every table so each test starts from a known state. */
  readonly truncate: () => Promise<void>;
  readonly close: () => Promise<void>;
};

export function resolveTestDatabaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const url = env["TEST_DATABASE_URL"] ?? env["DATABASE_URL"];
  if (url === undefined || url.trim() === "") {
    throw new Error(
      "Integration tests need a real PostgreSQL database. Set TEST_DATABASE_URL (or DATABASE_URL).",
    );
  }
  return url;
}

/**
 * Connects to a disposable PostgreSQL database and applies migrations.
 *
 * PostgreSQL is never mocked for repository or integration tests: the ranking
 * rules live partly in SQL and in database constraints, and a fake would not
 * exercise either.
 */
export async function createTestDatabase(url = resolveTestDatabaseUrl()): Promise<TestDatabase> {
  const db = createDatabase({ url, max: 4 });
  await applyMigrations(db);
  const truncate = async (): Promise<void> => {
    await db.execute(sql.raw(`truncate table ${ALL_TABLES.join(", ")} restart identity cascade`));
  };
  await truncate();
  return {
    db,
    truncate,
    close: () => closeDatabase(db),
  };
}
