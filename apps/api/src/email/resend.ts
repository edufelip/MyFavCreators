import { createHmac, timingSafeEqual } from "node:crypto";
import { redactEmail } from "@creator-outdoor/domain";
import {
  EmailDeliveryError,
  type EmailMessage,
  type EmailProvider,
  unsubscribeHeaders,
} from "./provider";

export const RESEND_PROVIDER_NAME = "resend";

const DEFAULT_API_ORIGIN = "https://api.resend.com";

/** The only HTTP capability this adapter needs. */
export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

export type ResendOptions = {
  readonly apiKey: string;
  /** A verified sender on the account, e.g. `Creator Outdoor <avisos@dominio>`. */
  readonly from: string;
  readonly apiOrigin?: string;
  readonly fetchImpl?: HttpFetch;
};

export function isResendConfigured(env: {
  readonly resendApiKey?: string | undefined;
  readonly emailFromAddress?: string | undefined;
}): boolean {
  return (
    env.resendApiKey !== undefined &&
    env.resendApiKey !== "" &&
    env.emailFromAddress !== undefined &&
    env.emailFromAddress !== ""
  );
}

/**
 * Sends through Resend (ADR 0013).
 *
 * Every message carries the RFC 8058 one-click unsubscribe headers, so a mail
 * client can offer the button itself. That is both the decent thing to do and
 * the practical one: a reader who cannot find the unsubscribe reports the mail
 * as spam, and a domain that collects those reports stops reaching anybody.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = RESEND_PROVIDER_NAME;

  private readonly apiOrigin: string;
  private readonly fetchImpl: HttpFetch;

  constructor(private readonly options: ResendOptions) {
    this.apiOrigin = options.apiOrigin ?? DEFAULT_API_ORIGIN;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  async send(message: EmailMessage): Promise<void> {
    const response = await this.fetchImpl(new URL("/emails", this.apiOrigin).toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: this.options.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html === undefined ? {} : { html: message.html }),
        headers: unsubscribeHeaders(message.unsubscribeUrl),
      }),
    });

    if (!response.ok) {
      /*
       * The provider's body can quote the recipient back, so it is read for
       * status only and never included in the error. An exception message ends
       * up in logs and error trackers, and neither is a place for somebody's
       * inbox.
       */
      throw new EmailDeliveryError(
        `Resend refused a message to ${redactEmail(message.to)} with status ${response.status}`,
      );
    }
  }
}

export type VerifyResendSignatureInput = {
  readonly svixId: string | null | undefined;
  readonly svixTimestamp: string | null | undefined;
  readonly svixSignature: string | null | undefined;
  readonly body: string | unknown;
  readonly secret: string;
  readonly toleranceSeconds?: number;
  readonly now?: Date;
};

/**
 * Verifies Resend webhook signatures using Svix standard specification.
 *
 * The signature binds the delivery to this message id, timestamp and exact payload.
 * Timestamp freshness is verified against toleranceSeconds (default: 300s / 5 minutes)
 * to close replay attack windows.
 */
export function verifyResendSignature(input: VerifyResendSignatureInput): boolean {
  if (
    !input.svixId ||
    !input.svixTimestamp ||
    !input.svixSignature ||
    !input.secret ||
    input.body === undefined ||
    input.body === null
  ) {
    return false;
  }

  const timestampNum = Number.parseInt(input.svixTimestamp, 10);
  if (!Number.isFinite(timestampNum)) {
    return false;
  }

  const now = input.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const toleranceSeconds = input.toleranceSeconds ?? 300;

  if (Math.abs(nowSeconds - timestampNum) > toleranceSeconds) {
    return false;
  }

  const rawBody = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
  const toSign = `${input.svixId}.${input.svixTimestamp}.${rawBody}`;

  let secretKey: Buffer;
  try {
    secretKey = input.secret.startsWith("whsec_")
      ? Buffer.from(input.secret.slice("whsec_".length), "base64")
      : Buffer.from(input.secret, "utf8");
  } catch {
    return false;
  }

  const expectedBase64 = createHmac("sha256", secretKey).update(toSign).digest("base64");
  const expectedSignature = `v1,${expectedBase64}`;
  const expectedBuf = Buffer.from(expectedSignature, "utf8");

  const candidates = input.svixSignature.trim().split(/\s+/);
  for (const candidate of candidates) {
    const candidateBuf = Buffer.from(candidate, "utf8");
    if (candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf)) {
      return true;
    }
  }

  return false;
}

/**
 * Creates a valid Svix / Resend signature header for a payload.
 * Useful for tests and simulated webhook deliveries.
 */
export function signResendPayload(input: {
  readonly svixId: string;
  readonly svixTimestamp: string | number;
  readonly body: string | unknown;
  readonly secret: string;
}): string {
  const ts = String(input.svixTimestamp);
  const rawBody = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
  const toSign = `${input.svixId}.${ts}.${rawBody}`;
  const secretKey = input.secret.startsWith("whsec_")
    ? Buffer.from(input.secret.slice("whsec_".length), "base64")
    : Buffer.from(input.secret, "utf8");
  return `v1,${createHmac("sha256", secretKey).update(toSign).digest("base64")}`;
}
