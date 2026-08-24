import type { ApiConfig } from "@creator-outdoor/config";
import { ConsoleEmailProvider } from "./console";
import type { EmailProvider } from "./provider";
import { isResendConfigured, ResendEmailProvider } from "./resend";

/**
 * Picks the email provider for this process.
 *
 * Credentials select the real provider; their absence selects the console one,
 * so the whole notification loop keeps working locally and in CI with no
 * external account. A **production** process with no credentials would silently
 * drop every notification somebody opted into, so it refuses to start instead.
 */
export function resolveEmailProvider(config: ApiConfig): EmailProvider {
  if (isResendConfigured(config)) {
    return new ResendEmailProvider({
      apiKey: config.resendApiKey ?? "",
      from: config.emailFromAddress ?? "",
    });
  }

  if (config.isProduction) {
    throw new Error(
      "A production API needs RESEND_API_KEY and EMAIL_FROM_ADDRESS; " +
        "refusing to start with an email provider that delivers nothing.",
    );
  }

  return new ConsoleEmailProvider();
}
