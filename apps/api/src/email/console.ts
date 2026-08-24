import { redactEmail } from "@creator-outdoor/domain";
import type { EmailMessage, EmailProvider } from "./provider";

/**
 * An email provider that delivers nothing.
 *
 * It exists so the whole notification loop — subscription, dedupe claim,
 * render, send, unsubscribe — can be built and tested end to end without an
 * external account, exactly as the fake PIX provider does for payments.
 *
 * The log line is deliberately incomplete: never a full address, never a body.
 * A development log is still a log, and it is the easiest place to leak
 * somebody's inbox.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  private readonly delivered: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.delivered.push(message);
    console.info("email_sent", {
      provider: this.name,
      to: redactEmail(message.to),
      subject: message.subject,
      oneClickUnsubscribe: message.unsubscribeUrl !== undefined,
    });
    return Promise.resolve();
  }

  /** What this process would have sent. Development and tests only. */
  outbox(): readonly EmailMessage[] {
    return this.delivered;
  }

  clear(): void {
    this.delivered.length = 0;
  }
}
