import { z } from "zod";
import { decodeOperators } from "./operators";
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
  /**
   * Production PIX credentials.
   *
   * Optional on purpose: a missing external credential must never block local
   * development or CI, so their absence selects the fake provider. A production
   * process without them refuses to start; see `resolvePaymentProvider`.
   */
  mercadoPagoAccessToken: z.string().min(1).optional(),
  mercadoPagoWebhookSecret: z.string().min(16).optional(),
  /**
   * Production email credentials.
   *
   * Optional for the same reason the PIX ones are: their absence selects the
   * console provider so local work and CI need no external account. A
   * production process without them refuses to start; see
   * `resolveEmailProvider`.
   */
  resendApiKey: z.string().min(1).optional(),
  emailFromAddress: z.string().min(3).optional(),
  /**
   * Where failures are reported. Absent means the log is the only record —
   * allowed, because a process that refuses to boot without an error service is
   * a worse outage than one whose failures are only in its own logs.
   */
  sentryDsn: z.string().min(1).optional(),
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
      mercadoPagoAccessToken: env["MERCADO_PAGO_ACCESS_TOKEN"],
      mercadoPagoWebhookSecret: env["MERCADO_PAGO_WEBHOOK_SECRET"],
      resendApiKey: env["RESEND_API_KEY"],
      emailFromAddress: env["EMAIL_FROM_ADDRESS"],
      sentryDsn: env["SENTRY_DSN"],
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

/**
 * Whether cookies this app sets may carry `Secure`.
 *
 * The scheme the site is actually served over, which is what the flag means —
 * not `NODE_ENV`, which `next start` sets to "production" whatever the scheme.
 * The two disagree on any HTTP stack, and the browser then silently drops the
 * cookie: a session that is never stored, a management token that never signs
 * anybody in, a click that can never be counted.
 *
 * Deliberately not a refusal. Requiring https whenever `NODE_ENV` says
 * production would repeat the same conflation from the other side — `next
 * build` sets that variable too, so it would block an ordinary local build of
 * the production bundle. "Do not serve this over plain HTTP" is a deployment
 * requirement, recorded in docs/security-and-privacy.md, and this function's
 * job is only to describe truthfully what is being served.
 */
function resolveCookieSecurity(origin: string): boolean {
  return origin.startsWith("https://");
}

const webEnvSchema = z.object({
  nodeEnv: nodeEnvSchema,
  apiOrigin: originSchema.default("http://localhost:3001"),
  webOrigin: originSchema.default("http://localhost:3000"),
});

export type WebConfig = z.infer<typeof webEnvSchema> & {
  readonly product: ProductConfig;
  readonly isProduction: boolean;
  /** Whether cookies this app sets may carry `Secure`. */
  readonly cookiesAreSecure: boolean;
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

  const isProduction = parsed.nodeEnv === "production";
  return {
    ...parsed,
    product: parseProductConfig(env),
    isProduction,
    cookiesAreSecure: resolveCookieSecurity(parsed.webOrigin),
  };
}

const adminEnvSchema = z.object({
  nodeEnv: nodeEnvSchema,
  apiOrigin: originSchema.default("http://localhost:3001"),
  adminOrigin: originSchema.default("http://localhost:3002"),
  /** Server-only. Held by the admin Next.js server, never sent to a browser. */
  adminApiSecret: z.string().min(16, "ADMIN_API_SECRET must be at least 16 characters"),
  /**
   * The named administrators, produced by `bun run admin:operator`. Each one
   * carries their own password hash and their own second factor so the audit
   * log can name a person rather than a shared account.
   */
  adminOperators: z
    .string()
    .min(1, "ADMIN_OPERATORS is required")
    .transform((encoded, context) => {
      try {
        return decodeOperators(encoded);
      } catch (error) {
        context.addIssue({
          code: "custom",
          message: error instanceof Error ? error.message : "ADMIN_OPERATORS is invalid",
        });
        return z.NEVER;
      }
    }),
  /** 32+ byte secret used to seal the administrator session cookie. */
  adminSessionSecret: z.string().min(32, "ADMIN_SESSION_SECRET must be at least 32 characters"),
  /**
   * Whether this process is serving a real deployment.
   *
   * A separate variable from `NODE_ENV`, and it has to be. Next sets
   * `NODE_ENV=production` itself for both `next build` and `next start`, so for
   * this app that value means "this is the production build" and never "this is
   * the production system". CI runs the production build. So does anybody
   * checking a build locally, and so does the E2E suite.
   *
   * Two security decisions were derived from `NODE_ENV` in this repository and
   * both were wrong in the same way: one failed a local build, the other
   * refused the E2E suite's own sign-in. Nothing sets this one for you, which
   * is the property being bought.
   */
  deployEnv: z.enum(["development", "production"]).default("development"),
});

export type AdminConfig = z.infer<typeof adminEnvSchema> & {
  /** True for the production *build*. Says nothing about where it runs. */
  readonly isProduction: boolean;
  /**
   * True only where a real deployment says so, in `DEPLOY_ENV`.
   *
   * This is the one to reach for when the question is "can the public reach
   * this?" — `isProduction` answers "was this built with optimisations on",
   * which `next build` and `next start` both answer yes to.
   */
  readonly isLiveDeployment: boolean;
  /** Whether cookies this app sets may carry `Secure`. */
  readonly cookiesAreSecure: boolean;
};

export function parseAdminConfig(env: EnvSource): AdminConfig {
  const parsed = parseOrThrow(
    adminEnvSchema,
    {
      nodeEnv: env["NODE_ENV"],
      apiOrigin: env["API_ORIGIN"],
      adminOrigin: env["ADMIN_ORIGIN"],
      adminApiSecret: env["ADMIN_API_SECRET"],
      adminOperators: env["ADMIN_OPERATORS"],
      adminSessionSecret: env["ADMIN_SESSION_SECRET"],
      deployEnv: env["DEPLOY_ENV"],
    },
    "apps/admin",
  );

  const isProduction = parsed.nodeEnv === "production";
  return {
    ...parsed,
    isProduction,
    isLiveDeployment: parsed.deployEnv === "production",
    cookiesAreSecure: resolveCookieSecurity(parsed.adminOrigin),
  };
}
