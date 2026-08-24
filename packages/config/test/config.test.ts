import { describe, expect, test } from "bun:test";
import { ConfigurationError } from "../src/parse";
import { PRODUCT_DEFAULTS, parseProductConfig } from "../src/product";
import { parseApiConfig, parseWebConfig } from "../src/runtime";

const VALID_API_ENV = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/creator_outdoor",
  ADMIN_API_SECRET: "a-server-only-admin-secret",
};

describe("product configuration", () => {
  test("falls back to the documented defaults", () => {
    expect(PRODUCT_DEFAULTS).toEqual({
      timezone: "America/Sao_Paulo",
      currency: "BRL",
      minBoostCents: 500,
      minIncrementCents: 100,
      rotationHours: 24,
      rotationFeedMax: 30,
      rotationBucketMinutes: 5,
      supporterMessageMax: 140,
      supporterNameMax: 40,
      sessionCookieDays: 90,
      supporterCookieDays: 365,
      weekStart: "MONDAY_00_00",
      launchCategory: "musica",
      fakePixExpirationMinutes: 30,
      submissionsPerHour: 5,
      reportsPerHour: 10,
      optOutRequestsPerHour: 5,
      optOutVerificationsPerHour: 20,
      boostsPerHour: 20,
      impressionsPerMinute: 240,
    });
  });

  test("reads overrides from the environment", () => {
    const config = parseProductConfig({
      MIN_BOOST_CENTS: "1000",
      ROTATION_HOURS: "48",
      LAUNCH_CATEGORY: "games",
    });
    expect(config.minBoostCents).toBe(1_000);
    expect(config.rotationHours).toBe(48);
    expect(config.launchCategory).toBe("games");
    expect(config.timezone).toBe("America/Sao_Paulo");
  });

  test("rejects a monetary configuration that is not a positive integer", () => {
    expect(() => parseProductConfig({ MIN_BOOST_CENTS: "5.5" })).toThrow(ConfigurationError);
    expect(() => parseProductConfig({ MIN_BOOST_CENTS: "0" })).toThrow(ConfigurationError);
    expect(() => parseProductConfig({ MIN_BOOST_CENTS: "-500" })).toThrow(ConfigurationError);
    expect(() => parseProductConfig({ MIN_INCREMENT_CENTS: "cem" })).toThrow(ConfigurationError);
  });

  test("rate limits are configuration, with the documented defaults", () => {
    expect(parseProductConfig({ RATE_LIMIT_SUBMISSIONS_PER_HOUR: "50" }).submissionsPerHour).toBe(
      50,
    );
    expect(() => parseProductConfig({ RATE_LIMIT_SUBMISSIONS_PER_HOUR: "0" })).toThrow(
      ConfigurationError,
    );
    expect(() => parseProductConfig({ RATE_LIMIT_IMPRESSIONS_PER_MINUTE: "-1" })).toThrow(
      ConfigurationError,
    );
  });

  test("rejects a currency or week start the product does not support", () => {
    expect(() => parseProductConfig({ CURRENCY: "USD" })).toThrow(ConfigurationError);
    expect(() => parseProductConfig({ WEEK_START: "SUNDAY_00_00" })).toThrow(ConfigurationError);
  });

  test("names the offending key so a misconfiguration is obvious", () => {
    expect(() => parseProductConfig({ ROTATION_HOURS: "-1" })).toThrow(/rotationHours/);
  });
});

describe("api configuration", () => {
  test("fails immediately when the database URL is missing", () => {
    expect(() => parseApiConfig({ ADMIN_API_SECRET: "a-server-only-admin-secret" })).toThrow(
      ConfigurationError,
    );
    expect(() => parseApiConfig({ ADMIN_API_SECRET: "a-server-only-admin-secret" })).toThrow(
      /databaseUrl/,
    );
  });

  test("refuses to boot without a strong internal admin secret", () => {
    const withoutSecret = { DATABASE_URL: VALID_API_ENV.DATABASE_URL };
    expect(() => parseApiConfig(withoutSecret)).toThrow(/adminApiSecret/);
    expect(() => parseApiConfig({ ...withoutSecret, ADMIN_API_SECRET: "curto" })).toThrow(
      /adminApiSecret/,
    );
  });

  test("builds the CORS allowlist from the configured origins", () => {
    const config = parseApiConfig({
      ...VALID_API_ENV,
      WEB_ORIGIN: "https://creatoroutdoor.com.br",
      ADMIN_ORIGIN: "https://admin.creatoroutdoor.com.br",
    });
    expect(config.corsAllowedOrigins).toEqual([
      "https://creatoroutdoor.com.br",
      "https://admin.creatoroutdoor.com.br",
    ]);
  });

  test("normalizes an origin and rejects anything that is not one", () => {
    expect(parseApiConfig({ ...VALID_API_ENV, WEB_ORIGIN: "https://exemplo.com" }).webOrigin).toBe(
      "https://exemplo.com",
    );
    for (const invalid of [
      "https://exemplo.com/painel",
      "https://exemplo.com?a=1",
      "exemplo.com",
      "ftp://exemplo.com",
      "javascript:alert(1)",
    ]) {
      expect(() => parseApiConfig({ ...VALID_API_ENV, WEB_ORIGIN: invalid }), invalid).toThrow(
        ConfigurationError,
      );
    }
  });

  test("carries the product configuration alongside the runtime configuration", () => {
    const config = parseApiConfig({ ...VALID_API_ENV, MIN_BOOST_CENTS: "700" });
    expect(config.product.minBoostCents).toBe(700);
    expect(config.isProduction).toBe(false);
  });

  test("recognises a production environment", () => {
    expect(parseApiConfig({ ...VALID_API_ENV, NODE_ENV: "production" }).isProduction).toBe(true);
  });

  test("rejects a port outside the valid range", () => {
    expect(() => parseApiConfig({ ...VALID_API_ENV, API_PORT: "0" })).toThrow(ConfigurationError);
    expect(() => parseApiConfig({ ...VALID_API_ENV, API_PORT: "70000" })).toThrow(
      ConfigurationError,
    );
  });
});

describe("web configuration", () => {
  test("defaults to the documented local origins", () => {
    const config = parseWebConfig({});
    expect(config.apiOrigin).toBe("http://localhost:3001");
    expect(config.webOrigin).toBe("http://localhost:3000");
  });

  test("requires the API origin to be a real origin", () => {
    expect(() => parseWebConfig({ API_ORIGIN: "not-a-url" })).toThrow(ConfigurationError);
  });
});
