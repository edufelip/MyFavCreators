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
    },
    "apps/admin",
  );

  return { ...parsed, isProduction: parsed.nodeEnv === "production" };
}
