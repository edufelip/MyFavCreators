import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isPaymentStatus, type PaymentStatus } from "@creator-outdoor/domain";
import {
  type CreatedPixPayment,
  type CreatePixPaymentInput,
  PaymentProviderError,
  type PixPaymentProvider,
  type ValidatedPaymentEvent,
  WebhookValidationError,
} from "./provider";

export const FAKE_PIX_PROVIDER_NAME = "fake-pix";
export const FAKE_PIX_SIGNATURE_HEADER = "x-fake-pix-signature";

type FakePayment = {
  providerPaymentId: string;
  /** The identifier inside the PIX payload, which the payer's bank sees. */
  txid: string;
  externalRef: string;
  amountCents: number;
  status: PaymentStatus;
  expiresAt: Date;
};

export type FakePixOptions = {
  readonly expirationMinutes: number;
  /** Signs simulated webhooks, so even the fake provider is authenticated. */
  readonly signingSecret: string;
  readonly now?: () => Date;
};

/**
 * A PIX provider that settles nothing.
 *
 * It exists so the entire boost loop — creation, QR, polling, webhook,
 * transactional activation, ranking movement, refund — can be built and tested
 * end to end before a real provider is chosen, and so the choice of provider is
 * an adapter swap rather than a rewrite.
 *
 * Its simulation endpoints are development-only and are never mounted in
 * production; see `createApp`.
 */
export class FakePixPaymentProvider implements PixPaymentProvider {
  readonly name = FAKE_PIX_PROVIDER_NAME;

  private readonly payments = new Map<string, FakePayment>();
  private readonly now: () => Date;

  constructor(private readonly options: FakePixOptions) {
    this.now = options.now ?? (() => new Date());
  }

  createPixPayment(input: CreatePixPaymentInput): Promise<CreatedPixPayment> {
    const providerPaymentId = `fake_${randomUUID()}`;
    /**
     * The payload identifier is generated independently of the payment handle.
     *
     * The copy-paste string is shown to the customer and pasted into a banking
     * app, so anything inside it is effectively public. The provider payment id
     * is the server-side idempotency and lookup key for webhooks and must never
     * travel in it.
     */
    const txid = randomUUID().replace(/-/g, "").slice(0, 25);
    const expiresAt = new Date(this.now().getTime() + this.options.expirationMinutes * 60 * 1000);
    this.payments.set(providerPaymentId, {
      providerPaymentId,
      txid,
      externalRef: input.externalRef,
      amountCents: input.amountCents,
      status: "PENDING",
      expiresAt,
    });

    // Shaped like a real PIX payload so the UI needs no special case later.
    const copyPaste = [
      "00020126",
      `br.gov.bcb.pix.${txid}`,
      "5204000053039865802BR",
      `54${String(input.amountCents / 100).padStart(6, "0")}`,
      `6207050${txid.slice(0, 8)}`,
    ].join("");

    return Promise.resolve({
      providerPaymentId,
      qrCode: copyPaste,
      copyPaste,
      expiresAt,
    });
  }

  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatus> {
    const payment = this.payments.get(providerPaymentId);
    if (payment === undefined) {
      return Promise.reject(new PaymentProviderError(`Unknown payment ${providerPaymentId}`));
    }
    // Expiry is a fact about time, not about anyone remembering to fire an event.
    if (payment.status === "PENDING" && payment.expiresAt.getTime() <= this.now().getTime()) {
      payment.status = "EXPIRED";
    }
    return Promise.resolve(payment.status);
  }

  async validateWebhook(request: Request): Promise<ValidatedPaymentEvent> {
    const body = await request.text();
    const signature = request.headers.get(FAKE_PIX_SIGNATURE_HEADER);
    if (signature === null || !this.signatureMatches(body, signature)) {
      throw new WebhookValidationError("Invalid fake PIX webhook signature");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new WebhookValidationError("Fake PIX webhook body is not JSON");
    }
    if (typeof payload !== "object" || payload === null) {
      throw new WebhookValidationError("Fake PIX webhook body is not an object");
    }

    const record = payload as Record<string, unknown>;
    const providerPaymentId = record["providerPaymentId"];
    const status = record["status"];
    const eventId = record["eventId"];
    if (typeof providerPaymentId !== "string" || !isPaymentStatus(status)) {
      throw new WebhookValidationError("Fake PIX webhook payload is malformed");
    }

    return {
      providerEventId: typeof eventId === "string" ? eventId : `${providerPaymentId}:${status}`,
      providerPaymentId,
      status,
      occurredAt: this.now(),
      rawPayload: payload,
    };
  }

  refundPayment(providerPaymentId: string): Promise<void> {
    const payment = this.payments.get(providerPaymentId);
    if (payment === undefined) {
      return Promise.reject(new PaymentProviderError(`Unknown payment ${providerPaymentId}`));
    }
    if (payment.status !== "CONFIRMED") {
      return Promise.reject(
        new PaymentProviderError(`Only a confirmed payment can be refunded, not ${payment.status}`),
      );
    }
    payment.status = "REFUNDED";
    return Promise.resolve();
  }

  /**
   * Moves a simulated payment, as a real provider's back office would.
   * Development only.
   */
  simulate(providerPaymentId: string, status: PaymentStatus): FakePayment {
    const payment = this.payments.get(providerPaymentId);
    if (payment === undefined) {
      throw new PaymentProviderError(`Unknown payment ${providerPaymentId}`);
    }
    payment.status = status;
    return payment;
  }

  /** The signature the provider would have attached. Development only. */
  sign(body: string): string {
    return createHmac("sha256", this.options.signingSecret).update(body).digest("hex");
  }

  private signatureMatches(body: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(body), "utf8");
    const provided = Buffer.from(signature, "utf8");
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }
}
