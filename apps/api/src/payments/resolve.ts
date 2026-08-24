import type { ApiConfig } from "@creator-outdoor/config";
import { FakePixPaymentProvider } from "./fake-pix";
import { isMercadoPagoConfigured, MercadoPagoPixProvider } from "./mercado-pago";
import type { PixPaymentProvider } from "./provider";

/**
 * Picks the payment provider for this process.
 *
 * Production credentials select the real provider; their absence selects the
 * fake one. A missing external credential must never block local development or
 * CI, so the whole boost flow keeps working either way — but a **production**
 * process with no credentials is a misconfiguration, not a fallback, and it
 * refuses to start rather than quietly taking payments that settle nothing.
 */
export function resolvePaymentProvider(config: ApiConfig): PixPaymentProvider {
  if (isMercadoPagoConfigured(config)) {
    return new MercadoPagoPixProvider({
      accessToken: config.mercadoPagoAccessToken ?? "",
      webhookSecret: config.mercadoPagoWebhookSecret ?? "",
      expirationMinutes: config.product.fakePixExpirationMinutes,
    });
  }

  if (config.isProduction) {
    throw new Error(
      "A production API needs MERCADO_PAGO_ACCESS_TOKEN and MERCADO_PAGO_WEBHOOK_SECRET; " +
        "refusing to start with the fake PIX provider.",
    );
  }

  return new FakePixPaymentProvider({
    expirationMinutes: config.product.fakePixExpirationMinutes,
    signingSecret: config.fanIdentitySecret,
  });
}
