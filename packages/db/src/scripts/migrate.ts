import { closeDatabase, createDatabase } from "../client";
import { applyMigrations } from "../migrate";
import { resolveDatabaseUrl } from "./database-url";

const url = resolveDatabaseUrl(process.env);
const database = createDatabase({ url, max: 1 });

try {
  await applyMigrations(database);
  console.info("Migrations applied.");
} finally {
  await closeDatabase(database);
}
