/**
 * Everything Creator Outdoor needs from an email service.
 *
 * The interface lives in the API's infrastructure layer, so domain logic never
 * depends on a mail SDK and swapping providers means writing one adapter rather
 * than touching notifications, the ranking or the payment loop — the same shape
 * as `PixPaymentProvider`.
 */

export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  /** Plain text is the message. HTML, when present, is a nicer rendering of it. */
  readonly text: string;
  readonly html?: string;
  /**
   * One-click unsubscribe (RFC 8058). Every notification carries it: an
   * unsubscribe that only works by finding a link in the body is an unsubscribe
   * people give up on and report as spam instead.
   */
  readonly unsubscribeUrl?: string;
};

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

export class EmailDeliveryError extends Error {
  override readonly name = "EmailDeliveryError";
}

/** The headers a mail client uses to offer one-click unsubscribe. */
export function unsubscribeHeaders(unsubscribeUrl: string | undefined): Record<string, string> {
  if (unsubscribeUrl === undefined) {
    return {};
  }
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
