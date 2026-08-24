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
} finally {
  await closeDatabase(database);
}
