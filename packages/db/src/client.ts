import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

export type Schema = typeof schema;

/**
 * The database handle. Only this package and apps/api may hold one:
 * apps/web and apps/admin reach business data over HTTP, never over SQL.
 */
export type Database = ReturnType<typeof createDatabase>;

/** A handle inside a transaction. Repositories accept either. */
export type DatabaseExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export type CreateDatabaseOptions = {
  readonly url: string;
  readonly max?: number;
};

export function createDatabase(options: CreateDatabaseOptions) {
  const client = new SQL({
    url: options.url,
    max: options.max ?? 10,
  });
  return drizzle({ client, schema });
}

export async function closeDatabase(database: Database): Promise<void> {
  await database.$client.close();
}
