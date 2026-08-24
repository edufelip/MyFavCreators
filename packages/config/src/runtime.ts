import { z } from "zod";
import { originSchema, portSchema } from "./origins";
import { type EnvSource, parseOrThrow } from "./parse";
import { type ProductConfig, parseProductConfig } from "./product";

/**
 * Pure configuration parsers.
 *
 * They take the environment as an argument and never read `process.env`
 * themselves, so a test can build any configuration and the eager per-runtime
 * singletons stay a thin layer on top.
 */

const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");

const apiEnvSchema = z.object({
  nodeEnv: nodeEnvSchema,
  port: portSchema.default(3001),
  databaseUrl: z.string().min(1, "DATABASE_URL is required"),
  /**
   * Server-only shared secret for apps/admin -> apps/api internal calls.
   * A production deployment must set a real one; the browser never sees it.
   */
  adminApiSecret: z.string().min(16, "ADMIN_API_SECRET must be at least 16 characters"),
  /**
   * Derives supporter grouping keys. Rotating it re-partitions the Torcida, so
   * it is set once per environment and never regenerated casually.
   */
  fanIdentitySecret: z.string().min(32, "FAN_IDENTITY_SECRET must be at least 32 characters"),
  webOrigin: originSchema.default("http://localhost:3000"),
  adminOrigin: originSchema.default("http://localhost:3002"),
});

export type ApiConfig = z.infer<typeof apiEnvSchema> & {
  readonly product: ProductConfig;
  readonly isProduction: boolean;
  /** Explicit allowlist. Sensitive API surfaces never answer `*`. */
  readonly corsAllowedOrigins: readonly string[];
};

export function parseApiConfig(env: EnvSource): ApiConfig {
  const parsed = parseOrThrow(
    apiEnvSchema,
    {
      nodeEnv: env["NODE_ENV"],
      port: env["API_PORT"],
      databaseUrl: env["DATABASE_URL"],
      adminApiSecret: env["ADMIN_API_SECRET"],
      fanIdentitySecret: env["FAN_IDENTITY_SECRET"],
      webOrigin: env["WEB_ORIGIN"],
      adminOrigin: env["ADMIN_ORIGIN"],
    },
    "apps/api",
  );

  return {
    ...parsed,
    product: parseProductConfig(env),
    isProduction: parsed.nodeEnv === "production",
    corsAllowedOrigins: [parsed.webOrigin, parsed.adminOrigin],
  };
}

const webEnvSchema = z.object({
  nodeEnv: nodeEnvSchema,
  apiOrigin: originSchema.default("http://localhost:3001"),
  webOrigin: originSchema.default("http://localhost:3000"),
});

export type WebConfig = z.infer<typeof webEnvSchema> & {
  readonly product: ProductConfig;
  readonly isProduction: boolean;
};

export function parseWebConfig(env: EnvSource): WebConfig {
  const parsed = parseOrThrow(
    webEnvSchema,
    {
      nodeEnv: env["NODE_ENV"],
      apiOrigin: env["API_ORIGIN"],
      webOrigin: env["WEB_ORIGIN"],
    },
    "apps/web",
  );

  return {
    ...parsed,
    product: parseProductConfig(env),
    isProduction: parsed.nodeEnv === "production",
  };
}

const adminEnvSchema = z.object({
  nodeEnv: nodeEnvSchema,
  apiOrigin: originSchema.default("http://localhost:3001"),
  adminOrigin: originSchema.default("http://localhost:3002"),
  /** Server-only. Held by the admin Next.js server, never sent to a browser. */
  adminApiSecret: z.string().min(16, "ADMIN_API_SECRET must be at least 16 characters"),
  /** scrypt hash of the administrator password, produced by `bun run admin:hash`. */
  adminPasswordHash: z.string().min(16, "ADMIN_PASSWORD_HASH is required"),
  /** 32+ byte secret used to seal the administrator session cookie. */
  adminSessionSecret: z.string().min(32, "ADMIN_SESSION_SECRET must be at least 32 characters"),
});

export type AdminConfig = z.infer<typeof adminEnvSchema> & {
  readonly isProduction: boolean;
};

export function parseAdminConfig(env: EnvSource): AdminConfig {
  const parsed = parseOrThrow(
    adminEnvSchema,
    {
      nodeEnv: env["NODE_ENV"],
      apiOrigin: env["API_ORIGIN"],
      adminOrigin: env["ADMIN_ORIGIN"],
      adminApiSecret: env["ADMIN_API_SECRET"],
      adminPasswordHash: env["ADMIN_PASSWORD_HASH"],
      adminSessionSecret: env["ADMIN_SESSION_SECRET"],
    },
    "apps/admin",
  );

  return { ...parsed, isProduction: parsed.nodeEnv === "production" };
}
