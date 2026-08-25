import { describe, expect, test } from "bun:test";
import { type ApiConfig, parseApiConfig } from "@creator-outdoor/config";
import { ConsoleEmailProvider } from "../../src/email/console";
import { EmailDeliveryError, unsubscribeHeaders } from "../../src/email/provider";
import {
  isResendConfigured,
  RESEND_PROVIDER_NAME,
  ResendEmailProvider,
} from "../../src/email/resend";
import { resolveEmailProvider } from "../../src/email/resolve";
import { dethroneEmail, weeklyRecapEmail } from "../../src/services/notification-templates";

const BASE_ENV: Record<string, string> = {
  DATABASE_URL: "postgres://user@127.0.0.1:5432/creator_outdoor",
  ADMIN_API_SECRET: "um-segredo-de-admin-suficiente",
  FAN_IDENTITY_SECRET: "um-segredo-de-identidade-de-fa-com-32-bytes",
};

function configFor(overrides: Record<string, string>): ApiConfig {
  return parseApiConfig({ ...BASE_ENV, ...overrides });
}

describe("one-click unsubscribe headers", () => {
  test("are the pair RFC 8058 requires", () => {
    expect(unsubscribeHeaders("https://exemplo/api/descadastrar/abc")).toEqual({
      "List-Unsubscribe": "<https://exemplo/api/descadastrar/abc>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  test("are absent rather than empty when there is no link", () => {
    expect(unsubscribeHeaders(undefined)).toEqual({});
  });
});

describe("the dethrone message", () => {
  const message = dethroneEmail({
    to: "ana@example.com",
    dethronedName: "Luna Verso",
    dethronedSlug: "luna-verso",
    challengerName: "Mara Beats",
    webOrigin: "https://exemplo",
    unsubToken: "token-de-teste",
  });

  test("names who took the top spot", () => {
    expect(message.subject).toBe("Mara Beats assumiu o #1");
    expect(message.text).toContain("Mara Beats assumiu o #1");
    expect(message.text).toContain("Luna Verso");
  });

  test("links to the public profile, never to the API", () => {
    expect(message.text).toContain("https://exemplo/criador/luna-verso");
    expect(message.text).not.toContain("/v1/");
  });

  test("carries a working unsubscribe in the body and in the headers", () => {
    expect(message.unsubscribeUrl).toBe("https://exemplo/api/descadastrar/token-de-teste");
    expect(message.text).toContain(message.unsubscribeUrl ?? "");
  });

  test("says why the reader is receiving it", () => {
    expect(message.text).toContain("porque pediu para acompanhar este perfil");
  });

  test("never implies money reached the creator, or promises anything", () => {
    const forbidden = ["apoi", "doa", "repasse", "vaquinha", "gorjeta", "sorteio", "premio"];
    const normalized = `${message.subject} ${message.text}`.toLowerCase();
    for (const term of forbidden) {
      expect(normalized.includes(term), term).toBe(false);
    }
  });

  test("escapes nothing into a link, because it is plain text", () => {
    const injected = dethroneEmail({
      to: "ana@example.com",
      dethronedName: "Luna",
      dethronedSlug: "luna",
      challengerName: "<script>alert(1)</script>",
      webOrigin: "https://exemplo",
      unsubToken: "t",
    });
    expect(injected.html).toBeUndefined();
    expect(injected.text).toContain("<script>alert(1)</script>");
  });
});

describe("the weekly recap message", () => {
  test("states the position reached and the money behind it", () => {
    const message = weeklyRecapEmail({
      to: "ana@example.com",
      creatorName: "Luna Verso",
      creatorSlug: "luna-verso",
      rank: 3,
      amountLabel: "R$120",
      supporterCount: 4,
      webOrigin: "https://exemplo",
      unsubToken: "t",
    });
    expect(message.subject).toContain("#3");
    expect(message.text).toContain("R$120 impulsionados, 4 pessoas na torcida");
  });

  test("says plainly that a week had no boosts", () => {
    const message = weeklyRecapEmail({
      to: "ana@example.com",
      creatorName: "Luna Verso",
      creatorSlug: "luna-verso",
      rank: null,
      amountLabel: "R$0",
      supporterCount: 0,
      webOrigin: "https://exemplo",
      unsubToken: "t",
    });
    expect(message.text).toContain("sem impulsos nesta semana");
  });
});

describe("the console provider", () => {
  test("keeps what it would have sent and never claims delivery", async () => {
    const provider = new ConsoleEmailProvider();
    await provider.send({ to: "ana@example.com", subject: "oi", text: "corpo" });
    expect(provider.outbox()).toHaveLength(1);
    provider.clear();
    expect(provider.outbox()).toHaveLength(0);
  });
});

describe("the production provider", () => {
  function providerWith(handler: (request: Request) => Response | Promise<Response>) {
    return new ResendEmailProvider({
      apiKey: "re_test",
      from: "Creator Outdoor <avisos@exemplo>",
      fetchImpl: (url, init) => Promise.resolve(handler(new Request(url, init))),
    });
  }

  test("sends the message with one-click unsubscribe headers", async () => {
    let seen: Record<string, unknown> | null = null;
    const provider = providerWith(async (request) => {
      seen = (await request.json()) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "sent" }), { status: 200 });
    });

    await provider.send({
      to: "ana@example.com",
      subject: "oi",
      text: "corpo",
      unsubscribeUrl: "https://exemplo/descadastrar/t",
    });

    const body = seen as Record<string, unknown> | null;
    expect(body?.["to"]).toEqual(["ana@example.com"]);
    expect(body?.["headers"]).toEqual({
      "List-Unsubscribe": "<https://exemplo/descadastrar/t>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  test("never leaks the recipient into an error message", async () => {
    const provider = providerWith(
      () =>
        new Response(JSON.stringify({ message: "invalid to: ana@example.com" }), { status: 422 }),
    );

    let thrown: unknown;
    try {
      await provider.send({ to: "ana@example.com", subject: "oi", text: "corpo" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EmailDeliveryError);
    const message = thrown instanceof Error ? thrown.message : "";
    expect(message).not.toContain("ana@example.com");
    expect(message).toContain("a***@example.com");
    expect(message).toContain("422");
  });

  test("requires both a key and a sender before it is considered configured", () => {
    expect(isResendConfigured({})).toBe(false);
    expect(isResendConfigured({ resendApiKey: "re_test" })).toBe(false);
    expect(isResendConfigured({ emailFromAddress: "a@b" })).toBe(false);
    expect(isResendConfigured({ resendApiKey: "", emailFromAddress: "a@b" })).toBe(false);
    expect(isResendConfigured({ resendApiKey: "re_test", emailFromAddress: "a@b" })).toBe(true);
  });
});

describe("choosing the email provider", () => {
  test("uses the real provider when both credentials are present", () => {
    const provider = resolveEmailProvider(
      configFor({ RESEND_API_KEY: "re_test", EMAIL_FROM_ADDRESS: "Creator Outdoor <a@b>" }),
    );
    expect(provider.name).toBe(RESEND_PROVIDER_NAME);
  });

  test("falls back to the console provider outside production", () => {
    expect(resolveEmailProvider(configFor({})).name).toBe("console");
  });

  test("refuses to start a production API without credentials", () => {
    // Otherwise every notification somebody opted into is silently dropped.
    expect(() => resolveEmailProvider(configFor({ NODE_ENV: "production" }))).toThrow(
      /RESEND_API_KEY/,
    );
  });
});
