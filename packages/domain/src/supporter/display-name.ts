export const ANONYMOUS_SUPPORTER_DISPLAY_NAME = "Anônimo";

export type SupporterDisplayInput = {
  readonly anonymous: boolean;
  readonly supporterName: string | null;
};

/**
 * The public label for a supporter.
 *
 * Supporters are never identified by display name internally — names are not
 * unique and must never be used to merge people. This is presentation only.
 */
export function resolveSupporterDisplayName(input: SupporterDisplayInput): string {
  if (input.anonymous) {
    return ANONYMOUS_SUPPORTER_DISPLAY_NAME;
  }
  const trimmed = input.supporterName?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : ANONYMOUS_SUPPORTER_DISPLAY_NAME;
}
