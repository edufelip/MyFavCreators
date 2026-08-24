import { describe, expect, test } from "bun:test";
import { type ApiConfig, parseApiConfig } from "@creator-outdoor/config";
import { FAKE_PIX_PROVIDER_NAME } from "../../src/payments/fake-pix";
import { MERCADO_PAGO_PROVIDER_NAME } from "../../src/payments/mercado-pago";
import { resolvePaymentProvider } from "../../src/payments/resolve";

const BASE_ENV: Record<string, string> = {
  DATABASE_URL: "postgres://user@127.0.0.1:5432/creator_outdoor",
  ADMIN_API_SECRET: "um-segredo-de-admin-suficiente",
  FAN_IDENTITY_SECRET: "um-segredo-de-identidade-de-fa-com-32-bytes",
};

function configFor(overrides: Record<string, string>): ApiConfig {
  return parseApiConfig({ ...BASE_ENV, ...overrides });
}

describe("choosing the payment provider", () => {
  test("uses the real provider when both credentials are present", () => {
    const provider = resolvePaymentProvider(
      configFor({
        MERCADO_PAGO_ACCESS_TOKEN: "APP_USR-token",
        MERCADO_PAGO_WEBHOOK_SECRET: "um-segredo-de-webhook-longo",
      }),
    );
    expect(provider.name).toBe(MERCADO_PAGO_PROVIDER_NAME);
  });

  test("falls back to the fake provider outside production", () => {
    // A missing external credential must never stop someone running the whole
    // boost flow locally or in CI.
    for (const nodeEnv of ["development", "test"]) {
      expect(resolvePaymentProvider(configFor({ NODE_ENV: nodeEnv })).name).toBe(
        FAKE_PIX_PROVIDER_NAME,
      );
    }
  });

  test("refuses to start a production API without credentials", () => {
    // The fake provider settles nothing. Taking real money through it would be
    // charging people for a promotion no bank ever confirms.
    expect(() => resolvePaymentProvider(configFor({ NODE_ENV: "production" }))).toThrow(
      /MERCADO_PAGO_ACCESS_TOKEN/,
    );
  });

  test("refuses a production API holding only half the credentials", () => {
    expect(() =>
      resolvePaymentProvider(
        configFor({ NODE_ENV: "production", MERCADO_PAGO_ACCESS_TOKEN: "APP_USR-token" }),
      ),
    ).toThrow(/refusing to start/);
  });

  test("never reports the real provider's name for the fake one", () => {
    // The webhook route dispatches on this name. A fake provider answering to
    // the real provider's route would accept unauthenticated events.
    expect(FAKE_PIX_PROVIDER_NAME).not.toBe(MERCADO_PAGO_PROVIDER_NAME);
    expect(resolvePaymentProvider(configFor({})).name).toBe(FAKE_PIX_PROVIDER_NAME);
  });
});
