import { join } from "node:path";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import type { Database } from "./client";

export const MIGRATIONS_FOLDER = join(import.meta.dir, "..", "migrations");

/**
 * Applies committed migrations.
 *
 * Migrations are explicit artifacts. Schema changes never reach production
 * through an automatic push, and this never runs as part of a generic build.
 */
export async function applyMigrations(database: Database): Promise<void> {
  await migrate(database, { migrationsFolder: MIGRATIONS_FOLDER });
}
