import { sql } from "drizzle-orm";
import { closeDatabase, createDatabase } from "../client";
import { applyMigrations } from "../migrate";
import { isProductionEnvironment, resolveDatabaseUrl } from "./database-url";

if (isProductionEnvironment(process.env)) {
  throw new Error("Refusing to drop the schema with NODE_ENV=production");
}

const url = resolveDatabaseUrl(process.env);
const database = createDatabase({ url, max: 1 });

try {
  await database.execute(sql`drop schema if exists public cascade`);
  await database.execute(sql`create schema public`);
  await database.execute(sql`drop schema if exists drizzle cascade`);
  await applyMigrations(database);
  console.info("Schema dropped and migrations re-applied.");
} finally {
  await closeDatabase(database);
}
