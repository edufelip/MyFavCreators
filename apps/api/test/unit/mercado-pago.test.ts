import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { requireInteger, requireRecord } from "@creator-outdoor/db";
import { PAYMENT_STATUSES } from "@creator-outdoor/domain";
import {
  isMercadoPagoConfigured,
  MercadoPagoPixProvider,
  mapMercadoPagoStatus,
  verifyMercadoPagoSignature,
} from "../../src/payments/mercado-pago";
import { PaymentProviderError, WebhookValidationError } from "../../src/payments/provider";

const SECRET = "um-segredo-de-webhook-do-provedor";
const NOW = new Date("2026-08-19T18:30:00.000Z");

function signature(dataId: string, requestId: string, at: Date = NOW, secret = SECRET): string {
  const ts = Math.floor(at.getTime() / 1000);
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

describe("status mapping", () => {
  test("maps the provider's settled states", () => {
    expect(mapMercadoPagoStatus("approved")).toBe("CONFIRMED");
    expect(mapMercadoPagoStatus("authorized")).toBe("CONFIRMED");
    expect(mapMercadoPagoStatus("rejected")).toBe("FAILED");
    expect(mapMercadoPagoStatus("cancelled")).toBe("CANCELLED");
    expect(mapMercadoPagoStatus("expired")).toBe("EXPIRED");
    expect(mapMercadoPagoStatus("refunded")).toBe("REFUNDED");
    expect(mapMercadoPagoStatus("charged_back")).toBe("REFUNDED");
  });

  test("maps in-flight states to PENDING", () => {
    for (const status of ["pending", "in_process", "in_mediation"]) {
      expect(mapMercadoPagoStatus(status), status).toBe("PENDING");
    }
  });

  test("refuses to guess at an unknown state", () => {
    // Guessing CONFIRMED would activate a boost for money that never arrived;
    // guessing FAILED would throw away a payment that is merely slow.
    for (const status of ["", "unknown", "APPROVED", "novo_status"]) {
      expect(mapMercadoPagoStatus(status), status).toBeNull();
    }
  });

  test("every mapped value is a status we actually model", () => {
    for (const status of ["approved", "pending", "rejected", "cancelled", "expired", "refunded"]) {
      const mapped = mapMercadoPagoStatus(status);
      expect(mapped).not.toBeNull();
      expect(PAYMENT_STATUSES).toContain(mapped as never);
    }
  });
});

describe("webhook signature", () => {
  test("accepts a correctly signed delivery", () => {
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: signature("12345", "req-1"),
        requestId: "req-1",
        dataId: "12345",
        secret: SECRET,
        now: NOW,
      }),
    ).toBe(true);
  });

  test("refuses a signature made with another secret", () => {
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: signature("12345", "req-1", NOW, "outro-segredo-qualquer"),
        requestId: "req-1",
        dataId: "12345",
        secret: SECRET,
        now: NOW,
      }),
    ).toBe(false);
  });

  test("refuses a signature captured from a different payment", () => {
    // The manifest binds the signature to the payment id, so a valid signature
    // cannot be replayed onto someone else's charge.
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: signature("99999", "req-1"),
        requestId: "req-1",
        dataId: "12345",
        secret: SECRET,
        now: NOW,
      }),
    ).toBe(false);
  });

  test("refuses a signature bound to a different request id", () => {
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: signature("12345", "req-1"),
        requestId: "req-2",
        dataId: "12345",
        secret: SECRET,
        now: NOW,
      }),
    ).toBe(false);
  });

  test("refuses a stale delivery, closing the replay window", () => {
    const old = new Date(NOW.getTime() - 10 * 60_000);
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: signature("12345", "req-1", old),
        requestId: "req-1",
        dataId: "12345",
        secret: SECRET,
        now: NOW,
      }),
    ).toBe(false);
  });

  test("refuses a delivery timestamped in the future", () => {
    const ahead = new Date(NOW.getTime() + 10 * 60_000);
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: signature("12345", "req-1", ahead),
        requestId: "req-1",
        dataId: "12345",
        secret: SECRET,
        now: NOW,
      }),
    ).toBe(false);
  });

  test("refuses malformed or missing headers", () => {
    for (const header of [null, "", "v1=abc", "ts=123", "garbage", "ts=abc,v1=def"]) {
      expect(
        verifyMercadoPagoSignature({
          signatureHeader: header,
          requestId: "req-1",
          dataId: "12345",
          secret: SECRET,
          now: NOW,
        }),
        String(header),
      ).toBe(false);
    }
  });

  test("fails closed when no secret is configured", () => {
    expect(
      verifyMercadoPagoSignature({
        signatureHeader: signature("12345", "req-1"),
        requestId: "req-1",
        dataId: "12345",
        secret: "",
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("provider adapter", () => {
  function providerWith(handler: (request: Request) => Response | Promise<Response>) {
    return new MercadoPagoPixProvider({
      accessToken: "token-de-teste",
      webhookSecret: SECRET,
      expirationMinutes: 30,
      now: () => NOW,
      fetchImpl: (url, init) => Promise.resolve(handler(new Request(url, init))),
    });
  }

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  test("creates a PIX charge and returns the payload", async () => {
    /*
     * Collected into an array rather than a nullable local: TypeScript cannot
     * see that a callback assigned it, so a nullable local narrows to `null`
     * here and the only way to read it is a cast. An array needs none.
     */
    const seen: Array<{ url: string; body: unknown; idempotencyKey: string | null }> = [];
    const provider = providerWith(async (request) => {
      seen.push({
        url: request.url,
        body: await request.json(),
        idempotencyKey: request.headers.get("x-idempotency-key"),
      });
      return json({
        id: 998877,
        status: "pending",
        point_of_interaction: {
          transaction_data: { qr_code: "00020126-pix-payload", qr_code_base64: "aGk=" },
        },
      });
    });

    const created = await provider.createPixPayment({ amountCents: 2_500, externalRef: "ref-1" });
    expect(created.providerPaymentId).toBe("998877");
    expect(created.copyPaste).toBe("00020126-pix-payload");
    const request = seen[0];
    expect(request).toBeDefined();
    // Amounts cross the wire in reais; the boundary is the only place that happens.
    expect(requireInteger(requireRecord(request?.body), "transaction_amount")).toBe(25);
    // A retried create must not produce a second charge for one boost.
    expect(request?.idempotencyKey).toBe("ref-1");
  });

  test("refuses a create response without a usable charge", async () => {
    const provider = providerWith(() => json({ id: 1, status: "pending" }));
    await expect(
      provider.createPixPayment({ amountCents: 500, externalRef: "ref" }),
    ).rejects.toBeInstanceOf(PaymentProviderError);
  });

  test("never leaks the provider's error body", async () => {
    const provider = providerWith(() =>
      json({ message: "invalid access token abc123", cause: [{ code: 2034 }] }, 401),
    );
    await expect(provider.getPaymentStatus("1")).rejects.toThrow(/responded 401/);
    await expect(provider.getPaymentStatus("1")).rejects.not.toThrow(/abc123/);
  });

  test("re-reads the payment rather than trusting the webhook body", async () => {
    // The notification says only "something happened"; a forged body must not be
    // able to assert a status.
    let lookups = 0;
    const provider = providerWith((request) => {
      if (request.method === "GET") {
        lookups += 1;
        return json({ id: 12345, status: "approved" });
      }
      return json({});
    });

    const body = JSON.stringify({ id: 42, type: "payment", data: { id: "12345" } });
    const event = await provider.validateWebhook(
      new Request("https://api.creatoroutdoor.test/webhook", {
        method: "POST",
        headers: {
          "x-signature": signature("12345", "req-9"),
          "x-request-id": "req-9",
          "content-type": "application/json",
        },
        body,
      }),
    );

    expect(lookups).toBe(1);
    expect(event.status).toBe("CONFIRMED");
    expect(event.providerPaymentId).toBe("12345");
    expect(event.providerEventId).toBe("42");
  });

  test("rejects an unsigned webhook without ever asking the provider", async () => {
    let lookups = 0;
    const provider = providerWith((request) => {
      if (request.method === "GET") {
        lookups += 1;
      }
      return json({ id: 12345, status: "approved" });
    });

    await expect(
      provider.validateWebhook(
        new Request("https://api.creatoroutdoor.test/webhook", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data: { id: "12345" } }),
        }),
      ),
    ).rejects.toBeInstanceOf(WebhookValidationError);
    expect(lookups).toBe(0);
  });

  test("rejects a webhook carrying no payment id", async () => {
    const provider = providerWith(() => json({}));
    await expect(
      provider.validateWebhook(
        new Request("https://api.creatoroutdoor.test/webhook", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "payment" }),
        }),
      ),
    ).rejects.toBeInstanceOf(WebhookValidationError);
  });

  test("accepts the payment id from the query string, as the provider sends it", async () => {
    const provider = providerWith((request) =>
      request.method === "GET" ? json({ id: 555, status: "approved" }) : json({}),
    );
    const event = await provider.validateWebhook(
      new Request("https://api.creatoroutdoor.test/webhook?data.id=555&type=payment", {
        method: "POST",
        headers: {
          "x-signature": signature("555", "req-3"),
          "x-request-id": "req-3",
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(event.providerPaymentId).toBe("555");
  });

  test("refunds idempotently", async () => {
    const keys: Array<string | null> = [];
    const provider = providerWith((request) => {
      keys.push(request.headers.get("x-idempotency-key"));
      return json({ status: "approved" });
    });
    await provider.refundPayment("777");
    await provider.refundPayment("777");
    expect(keys).toEqual(["refund:777", "refund:777"]);
  });
});

describe("configuration detection", () => {
  test("requires both credentials", () => {
    expect(isMercadoPagoConfigured({})).toBe(false);
    expect(isMercadoPagoConfigured({ mercadoPagoAccessToken: "t" })).toBe(false);
    expect(isMercadoPagoConfigured({ mercadoPagoWebhookSecret: "s" })).toBe(false);
    expect(
      isMercadoPagoConfigured({ mercadoPagoAccessToken: "", mercadoPagoWebhookSecret: "s" }),
    ).toBe(false);
    expect(
      isMercadoPagoConfigured({ mercadoPagoAccessToken: "t", mercadoPagoWebhookSecret: "s" }),
    ).toBe(true);
  });
});
