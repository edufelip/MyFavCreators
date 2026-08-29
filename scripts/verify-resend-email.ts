#!/usr/bin/env bun
/**
 * Live Resend Email Verification CLI Tool (ADR 0013)
 *
 * Verifies live credentials, authenticated domain sender, and delivery
 * with RFC 8058 one-click unsubscribe headers against the Resend API.
 *
 * Usage:
 *   RESEND_API_KEY="..." EMAIL_FROM_ADDRESS="Creator Outdoor <avisos@domain.com>" bun run scripts/verify-resend-email.ts <recipient-email>
 */

import { ResendEmailProvider } from "../apps/api/src/email/resend";

async function main() {
  const apiKey = process.env["RESEND_API_KEY"];
  const fromAddress = process.env["EMAIL_FROM_ADDRESS"];
  const recipient = process.argv[2] ?? "operacoes@creatoroutdoor.com.br";

  if (!apiKey || apiKey.trim() === "") {
    console.error("Error: RESEND_API_KEY is required in environment.");
    process.exit(1);
  }
  if (!fromAddress || fromAddress.trim() === "") {
    console.error(
      "Error: EMAIL_FROM_ADDRESS is required in environment (e.g. 'Creator Outdoor <avisos@domain.com>').",
    );
    process.exit(1);
  }

  console.log("----------------------------------------------------------------");
  console.log("          Creator Outdoor - Resend Email Verification           ");
  console.log("----------------------------------------------------------------");
  console.log(`API Key:      ${apiKey.slice(0, 8)}... (redacted)`);
  console.log(`From Address: ${fromAddress}`);
  console.log(`To Address:   ${recipient}`);

  const provider = new ResendEmailProvider({
    apiKey,
    from: fromAddress,
  });

  const testMessage = {
    to: recipient,
    subject: "[Verificação] Creator Outdoor - Teste de Envio Transacional",
    text: "Esta é uma mensagem de verificação do Creator Outdoor para testar entrega, autenticação de remetente (SPF/DKIM/DMARC) e cabeçalhos de descadastro em conformidade com o ADR 0013.",
    html: "<p>Esta é uma mensagem de verificação do <strong>Creator Outdoor</strong> para testar entrega, autenticação de remetente (SPF/DKIM/DMARC) e cabeçalhos de descadastro em conformidade com o ADR 0013.</p>",
    unsubscribeUrl: "https://creatoroutdoor.com.br/api/descadastrar/token-de-verificacao",
  };

  console.log("\n1. Sending test email via Resend API (/emails)...");
  try {
    await provider.send(testMessage);
    console.log("✔ Email accepted by Resend API!");
    console.log(`  Recipient: ${recipient}`);
    console.log(`  List-Unsubscribe: <${testMessage.unsubscribeUrl}>`);
    console.log(`  List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
    console.log("\n2. Next steps for production DNS authentication:");
    console.log("  - Check Resend dashboard (Domains tab) to verify SPF, DKIM, and DMARC status.");
    console.log("  - Check the received email in inbox and verify SPF/DKIM headers pass.");
    console.log("----------------------------------------------------------------\n");
  } catch (error) {
    console.error("✖ Email send failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
