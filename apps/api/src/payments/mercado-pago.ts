import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentStatus } from "@creator-outdoor/domain";
import {
  type CreatedPixPayment,
  type CreatePixPaymentInput,
  PaymentProviderError,
  type PixPaymentProvider,
  type ValidatedPaymentEvent,
  WebhookValidationError,
} from "./provider";

export const MERCADO_PAGO_PROVIDER_NAME = "mercado-pago";

const SIGNATURE_HEADER = "x-signature";
const REQUEST_ID_HEADER = "x-request-id";
const DEFAULT_API_ORIGIN = "https://api.mercadopago.com";

/**
 * The only HTTP capability this adapter needs.
 *
 * Narrower than `typeof fetch` on purpose: depending on the whole global means a
 * test double has to reimplement parts of it that the adapter never calls, and
 * the wider a port is, the less it says about what the code actually does.
 */
export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

export type MercadoPagoOptions = {
  readonly accessToken: string;
  readonly webhookSecret: string;
  readonly apiOrigin?: string;
  readonly expirationMinutes: number;
  readonly now?: () => Date;
  /** Injected in tests so the adapter can be exercised without the network. */
  readonly fetchImpl?: HttpFetch;
};

/**
 * Maps a provider status onto ours.
 *
 * Deliberately exhaustive and conservative: anything unrecognised is treated as
 * still pending rather than guessed at, because guessing `CONFIRMED` would
 * activate a boost for money that never arrived, and guessing `FAILED` would
 * throw away a payment that is merely slow.
 */
export function mapMercadoPagoStatus(status: string): PaymentStatus | null {
  switch (status) {
    case "approved":
    case "authorized":
      return "CONFIRMED";
    case "pending":
    case "in_process":
    case "in_mediation":
      return "PENDING";
    case "rejected":
      return "FAILED";
    case "cancelled":
      return "CANCELLED";
    case "expired":
      return "EXPIRED";
    case "refunded":
    case "charged_back":
      return "REFUNDED";
    default:
      return null;
  }
}

/**
 * Verifies the signed webhook header.
 *
 * The manifest binds the signature to this specific delivery — the payment id,
 * the request id and the timestamp — so a signature captured from one webhook
 * cannot be replayed onto another. The timestamp is also checked against a
 * tolerance, which closes the window on replaying the *same* delivery later.
 */
export function verifyMercadoPagoSignature(input: {
  readonly signatureHeader: string | null;
  readonly requestId: string | null;
  readonly dataId: string;
  readonly secret: string;
  readonly now: Date;
  readonly toleranceSeconds?: number;
}): boolean {
  if (input.signatureHeader === null || input.secret === "") {
    return false;
  }

  const parts = new Map<string, string>();
  for (const segment of input.signatureHeader.split(",")) {
    const [key, value] = segment.split("=", 2);
    if (key !== undefined && value !== undefined) {
      parts.set(key.trim(), value.trim());
    }
  }
  const timestamp = parts.get("ts");
  const signature = parts.get("v1");
  if (timestamp === undefined || signature === undefined) {
    return false;
  }

  const timestampMs = Number.parseInt(timestamp, 10) * 1000;
  if (!Number.isFinite(timestampMs)) {
    return false;
  }
  const tolerance = (input.toleranceSeconds ?? 300) * 1000;
  if (Math.abs(input.now.getTime() - timestampMs) > tolerance) {
    return false;
  }

  const manifest = `id:${input.dataId};request-id:${input.requestId ?? ""};ts:${timestamp};`;
  const expected = Buffer.from(
    createHmac("sha256", input.secret).update(manifest).digest("hex"),
    "utf8",
  );
  const provided = Buffer.from(signature, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The production PIX provider.
 *
 * Everything provider-specific stops here. The webhook route, the payment
 * transition service and every idempotency guarantee are unchanged from the fake
 * provider, which is the point of the interface: choosing a provider is writing
 * an adapter, not touching the ranking or the payment state machine.
 */
export class MercadoPagoPixProvider implements PixPaymentProvider {
  readonly name = MERCADO_PAGO_PROVIDER_NAME;

  private readonly apiOrigin: string;
  private readonly now: () => Date;
  private readonly fetchImpl: HttpFetch;

  constructor(private readonly options: MercadoPagoOptions) {
    this.apiOrigin = options.apiOrigin ?? DEFAULT_API_ORIGIN;
    this.now = options.now ?? (() => new Date());
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  async createPixPayment(input: CreatePixPaymentInput): Promise<CreatedPixPayment> {
    const expiresAt = new Date(this.now().getTime() + this.options.expirationMinutes * 60_000);
    const payload = await this.request("/v1/payments", {
      method: "POST",
      headers: {
        // The provider's own idempotency guard, so a retried create cannot
        // produce two charges for one boost.
        "x-idempotency-key": input.externalRef,
      },
      body: JSON.stringify({
        transaction_amount: input.amountCents / 100,
        payment_method_id: "pix",
        external_reference: input.externalRef,
        date_of_expiration: expiresAt.toISOString(),
        description: "Creator Outdoor",
      }),
    });

    const id = payload["id"];
    const providerPaymentId = typeof id === "number" ? String(id) : id;
    const interaction = isRecord(payload["point_of_interaction"])
      ? payload["point_of_interaction"]
      : {};
    const transaction = isRecord(interaction["transaction_data"])
      ? interaction["transaction_data"]
      : {};
    const copyPaste = transaction["qr_code"];
    const qrBase64 = transaction["qr_code_base64"];

    if (typeof providerPaymentId !== "string" || typeof copyPaste !== "string") {
      throw new PaymentProviderError("Mercado Pago did not return a usable PIX charge");
    }

    return {
      providerPaymentId,
      qrCode: typeof qrBase64 === "string" && qrBase64 !== "" ? copyPaste : copyPaste,
      copyPaste,
      expiresAt,
    };
  }

  async getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus> {
    const payload = await this.request(`/v1/payments/${encodeURIComponent(providerPaymentId)}`, {
      method: "GET",
    });
    const status = payload["status"];
    const mapped = typeof status === "string" ? mapMercadoPagoStatus(status) : null;
    if (mapped === null) {
      throw new PaymentProviderError(`Unrecognised Mercado Pago status: ${String(status)}`);
    }
    return mapped;
  }

  /**
   * Authenticates a webhook and turns it into a validated event.
   *
   * The notification carries only an id, so the payment is re-read from the API
   * before anything is applied. That means a forged body cannot assert a status,
   * and a genuine notification that arrives out of order still resolves to the
   * payment's real state.
   */
  async validateWebhook(request: Request): Promise<ValidatedPaymentEvent> {
    const raw = await request.text();
    let body: unknown;
    try {
      body = JSON.parse(raw === "" ? "{}" : raw);
    } catch {
      throw new WebhookValidationError("Mercado Pago webhook body is not JSON");
    }
    if (!isRecord(body)) {
      throw new WebhookValidationError("Mercado Pago webhook body is not an object");
    }

    const data = isRecord(body["data"]) ? body["data"] : {};
    const dataIdFromBody = data["id"];
    const dataIdFromQuery = new URL(request.url).searchParams.get("data.id");
    const dataId =
      typeof dataIdFromBody === "string"
        ? dataIdFromBody
        : typeof dataIdFromBody === "number"
          ? String(dataIdFromBody)
          : (dataIdFromQuery ?? "");
    if (dataId === "") {
      throw new WebhookValidationError("Mercado Pago webhook carries no payment id");
    }

    const verified = verifyMercadoPagoSignature({
      signatureHeader: request.headers.get(SIGNATURE_HEADER),
      requestId: request.headers.get(REQUEST_ID_HEADER),
      dataId,
      secret: this.options.webhookSecret,
      now: this.now(),
    });
    if (!verified) {
      throw new WebhookValidationError("Mercado Pago webhook signature is invalid or stale");
    }

    // The notification says only "something happened to this payment"; the
    // provider's own record decides what.
    const status = await this.getPaymentStatus(dataId);
    const eventId = body["id"];

    return {
      providerEventId:
        typeof eventId === "string" || typeof eventId === "number"
          ? String(eventId)
          : `${dataId}:${status}`,
      providerPaymentId: dataId,
      status,
      occurredAt: this.now(),
      rawPayload: body,
    };
  }

  async refundPayment(providerPaymentId: string): Promise<void> {
    await this.request(`/v1/payments/${encodeURIComponent(providerPaymentId)}/refunds`, {
      method: "POST",
      headers: { "x-idempotency-key": `refund:${providerPaymentId}` },
      body: "{}",
    });
  }

  private async request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(new URL(path, this.apiOrigin).toString(), {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${this.options.accessToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
    });

    if (!response.ok) {
      // The provider's error body may contain account details; only the status
      // reaches our logs.
      throw new PaymentProviderError(`Mercado Pago ${path} responded ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      throw new PaymentProviderError(`Mercado Pago ${path} returned an unexpected body`);
    }
    return payload;
  }
}

export function isMercadoPagoConfigured(env: {
  readonly mercadoPagoAccessToken?: string | undefined;
  readonly mercadoPagoWebhookSecret?: string | undefined;
}): boolean {
  return (
    env.mercadoPagoAccessToken !== undefined &&
    env.mercadoPagoAccessToken !== "" &&
    env.mercadoPagoWebhookSecret !== undefined &&
    env.mercadoPagoWebhookSecret !== ""
  );
}
