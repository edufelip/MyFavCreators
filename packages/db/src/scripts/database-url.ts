/**
 * Resolves the target database for a maintenance script.
 *
 * Scripts are explicit deployment steps, never a side effect of `build`: the
 * URL must be supplied, and nothing is ever pushed straight from the schema.
 */
export function resolveDatabaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const url = env["DATABASE_URL"];
  if (url === undefined || url.trim() === "") {
    throw new Error("DATABASE_URL must be set");
  }
  return url;
}

export function isProductionEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env["NODE_ENV"] === "production";
}
