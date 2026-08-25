import type { ApiConfig } from "@creator-outdoor/config";
import { ConsoleErrorTracker } from "./console-tracker";
import { isSentryConfigured, SentryErrorTracker } from "./sentry";
import type { ErrorTracker } from "./tracker";

/**
 * Picks the error tracker for this process.
 *
 * A DSN selects Sentry; its absence selects the console, so a local run and CI
 * keep working with no external account and the failure paths are exercised
 * either way.
 *
 * Unlike the email provider, a production process without a DSN is allowed to
 * start. A missing email provider silently drops something a person asked for;
 * a missing tracker only means failures are in the log and nowhere else, which
 * is a smaller and more visible loss than refusing to boot.
 */
export function resolveErrorTracker(config: ApiConfig): ErrorTracker {
  if (isSentryConfigured(config.sentryDsn)) {
    return new SentryErrorTracker({
      dsn: config.sentryDsn ?? "",
      environment: config.nodeEnv,
    });
  }
  return new ConsoleErrorTracker();
}
