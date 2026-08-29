import { parseProductConfig } from "@creator-outdoor/config";
import { closeDatabase, createDatabase } from "../client";
import { seedDatabase } from "../seed";
import { isProductionEnvironment, resolveDatabaseUrl } from "./database-url";

if (isProductionEnvironment(process.env)) {
  throw new Error("Refusing to seed fixture data with NODE_ENV=production");
}

const url = resolveDatabaseUrl(process.env);
const database = createDatabase({ url, max: 1 });

try {
  const summary = await seedDatabase(database, { product: parseProductConfig(process.env) });
  console.info(
    `Seeded ${summary.categories} categories, ${summary.creators} creators and ${summary.boosts} confirmed boosts (${summary.confirmedCents} centavos).`,
  );
  /*
   * The weeks this just invented are still open.
   *
   * Closing them is the rollover's job and it lives in `apps/api`, which this
   * package cannot import — so the root `bun run db:seed` runs both, and that
   * is the command the README, the runbook and CI all use. Running this script
   * on its own leaves a database whose Hall da Fama is empty and whose home
   * page looks fine, which is the kind of half-state that gets debugged for an
   * hour before somebody remembers the second command.
   */
  console.info("Historical weeks are still open. Run: bun run job:weekly-rollover");
} finally {
  await closeDatabase(database);
}
