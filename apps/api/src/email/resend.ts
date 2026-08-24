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
