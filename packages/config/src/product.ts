import { z } from "zod";
import { type EnvSource, parseOrThrow } from "./parse";

const positiveInt = z.coerce.number().int().positive();

/**
 * Shared, non-secret product configuration. Defaults are the values documented
 * in the product specification; every deployment may override them via env.
 */
export const productConfigSchema = z.object({
  timezone: z.string().min(1).default("America/Sao_Paulo"),
  currency: z.literal("BRL").default("BRL"),
  minBoostCents: positiveInt.default(500),
  minIncrementCents: positiveInt.default(100),
  rotationHours: positiveInt.default(24),
  rotationFeedMax: positiveInt.default(30),
  rotationBucketMinutes: positiveInt.default(5),
  supporterMessageMax: positiveInt.default(140),
  supporterNameMax: positiveInt.default(40),
  sessionCookieDays: positiveInt.default(90),
  supporterCookieDays: positiveInt.default(365),
  weekStart: z.literal("MONDAY_00_00").default("MONDAY_00_00"),
  launchCategory: z.string().min(1).default("musica"),
  fakePixExpirationMinutes: positiveInt.default(30),
  /**
   * Write-heavy public endpoints, per client per hour. Rate limits are
   * configuration like any other product constant: a load test or an end-to-end
   * suite raises them explicitly rather than the code disabling them.
   */
  submissionsPerHour: positiveInt.default(5),
  reportsPerHour: positiveInt.default(10),
  optOutRequestsPerHour: positiveInt.default(5),
  optOutVerificationsPerHour: positiveInt.default(20),
  boostsPerHour: positiveInt.default(20),
  impressionsPerMinute: positiveInt.default(240),
});

export type ProductConfig = z.infer<typeof productConfigSchema>;

export function parseProductConfig(env: EnvSource): ProductConfig {
  return parseOrThrow(
    productConfigSchema,
    {
      timezone: env["TIMEZONE"],
      currency: env["CURRENCY"],
      minBoostCents: env["MIN_BOOST_CENTS"],
      minIncrementCents: env["MIN_INCREMENT_CENTS"],
      rotationHours: env["ROTATION_HOURS"],
      rotationFeedMax: env["ROTATION_FEED_MAX"],
      rotationBucketMinutes: env["ROTATION_BUCKET_MINUTES"],
      supporterMessageMax: env["SUPPORTER_MESSAGE_MAX"],
      supporterNameMax: env["SUPPORTER_NAME_MAX"],
      sessionCookieDays: env["SESSION_COOKIE_DAYS"],
      supporterCookieDays: env["SUPPORTER_COOKIE_DAYS"],
      weekStart: env["WEEK_START"],
      launchCategory: env["LAUNCH_CATEGORY"],
      fakePixExpirationMinutes: env["FAKE_PIX_EXPIRATION_MINUTES"],
      submissionsPerHour: env["RATE_LIMIT_SUBMISSIONS_PER_HOUR"],
      reportsPerHour: env["RATE_LIMIT_REPORTS_PER_HOUR"],
      optOutRequestsPerHour: env["RATE_LIMIT_OPT_OUT_REQUESTS_PER_HOUR"],
      optOutVerificationsPerHour: env["RATE_LIMIT_OPT_OUT_VERIFICATIONS_PER_HOUR"],
      boostsPerHour: env["RATE_LIMIT_BOOSTS_PER_HOUR"],
      impressionsPerMinute: env["RATE_LIMIT_IMPRESSIONS_PER_MINUTE"],
    },
    "product",
  );
}

/** The specification defaults, resolved without any environment overrides. */
export const PRODUCT_DEFAULTS: ProductConfig = parseProductConfig({});
