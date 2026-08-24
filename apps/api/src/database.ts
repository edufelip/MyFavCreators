import { apiConfig } from "@creator-outdoor/config/api";
import { createDatabase, type Database } from "@creator-outdoor/db";

/**
 * The process-wide database handle.
 *
 * apps/api is the only application allowed to hold one. apps/web and
 * apps/admin reach business data over HTTP.
 */
export const database: Database = createDatabase({ url: apiConfig.databaseUrl });
