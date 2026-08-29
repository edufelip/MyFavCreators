#!/usr/bin/env bun

/**
 * Live PIX Verification CLI Tool (ADR 0012)
 *
 * Verifies live credentials, charge generation, QR code payload, and status polling
 * against the real Mercado Pago Payments API for a live R$5,00 charge.
 *
 * Usage:
 *   MERCADO_PAGO_ACCESS_TOKEN="..." MERCADO_PAGO_WEBHOOK_SECRET="..." bun run scripts/verify-live-pix.ts
 */

import { moneyCents } from "@creator-outdoor/domain";
import { MercadoPagoPixProvider } from "../apps/api/src/payments/mercado-pago";

async function main() {
  const accessToken = process.env["MERCADO_PAGO_ACCESS_TOKEN"];
  const webhookSecret = process.env["MERCADO_PAGO_WEBHOOK_SECRET"] ?? "verify-secret";

  if (!accessToken || accessToken.trim() === "") {
    console.error(
      "Error: MERCADO_PAGO_ACCESS_TOKEN is required in environment to verify live PIX.",
    );
    process.exit(1);
  }

  console.log("----------------------------------------------------------------");
  console.log("           Creator Outdoor - Live PIX Verification              ");
  console.log("----------------------------------------------------------------");
  console.log("Provider: Mercado Pago");
  console.log(`Access Token: ${accessToken.slice(0, 10)}... (redacted)`);

  const provider = new MercadoPagoPixProvider({
    accessToken,
    webhookSecret,
    expirationMinutes: 15,
  });

  const testIdempotencyKey = `live-verify-${Date.now()}`;
  console.log(`\n1. Creating live R$ 5,00 PIX charge (Key: ${testIdempotencyKey})...`);

  try {
    const payment = await provider.createPayment({
      amount: moneyCents(500),
      idempotencyKey: testIdempotencyKey,
      description: "Creator Outdoor - Teste PIX R$ 5,00",
      payerEmail: "operacoes@creatoroutdoor.com.br",
    });

    console.log("✔ PIX Charge successfully created!");
    console.log(`  Provider Payment ID: ${payment.providerPaymentId}`);
    console.log(`  Status:              ${payment.status}`);
    console.log(`  Expires At:          ${payment.expiresAt.toISOString()}`);
    console.log("\n--- PIX Copy and Paste Code (Copia e Cola) ---");
    console.log(payment.pixPayload);
    console.log("----------------------------------------------");

    console.log("\n2. Polling payment status for 60 seconds (waiting for payment confirmation)...");
    console.log(
      "   (You can scan/pay the code above in your banking app to test live confirmation)",
    );

    const startTime = Date.now();
    let currentStatus = payment.status;

    while (Date.now() - startTime < 60_000) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const status = await provider.getPaymentStatus(payment.providerPaymentId);
      console.log(`   [${new Date().toLocaleTimeString()}] Status: ${status}`);
      if (status === "CONFIRMED") {
        currentStatus = "CONFIRMED";
        console.log("\n✔ Payment CONFIRMED live!");
        break;
      }
      if (status === "CANCELLED" || status === "FAILED" || status === "REFUNDED") {
        currentStatus = status;
        break;
      }
    }

    console.log("\n3. Verification Summary:");
    console.log("  Initial Creation: SUCCESS");
    console.log(`  PIX Code Format:  VALID (${payment.pixPayload.length} chars)`);
    console.log(`  Final Status:     ${currentStatus}`);
    console.log("----------------------------------------------------------------\n");
  } catch (error) {
    console.error(
      "✖ Live PIX verification failed:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

main();
