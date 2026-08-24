/**
 * The proof-of-ownership code a person places in a creator profile.
 *
 * An unauthenticated visitor must never be able to hide a creator by asking, so
 * removal is only honoured once this code is visible on the profile itself.
 * The same mechanism verifies a claim later.
 */
export const OWNERSHIP_CODE_PREFIX = "CO";
export const OWNERSHIP_CODE_LENGTH = 8;

/** Deliberately excludes 0/O and 1/I/L, which people mistype when copying. */
export const OWNERSHIP_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function formatOwnershipCode(body: string): string {
  return `${OWNERSHIP_CODE_PREFIX}-${body.toUpperCase()}`;
}

const CODE_PATTERN = new RegExp(
  `^${OWNERSHIP_CODE_PREFIX}-[${OWNERSHIP_CODE_ALPHABET}]{${OWNERSHIP_CODE_LENGTH}}$`,
);

export function isWellFormedOwnershipCode(code: string): boolean {
  return CODE_PATTERN.test(code.trim().toUpperCase());
}

/**
 * Whether a profile's text carries the code.
 *
 * Tolerant about how people paste it — case, surrounding punctuation, emoji and
 * line breaks all vary — but never about the characters of the code itself.
 */
export function textContainsOwnershipCode(text: string, code: string): boolean {
  if (!isWellFormedOwnershipCode(code)) {
    return false;
  }
  // Strip every separator people insert: spaces, line breaks, underscores and
  // the whole family of hyphens and dashes an editor may have substituted.
  const normalize = (value: string) => value.toUpperCase().replace(/[\s_\-\u2010-\u2015]/g, "");
  return normalize(text).includes(normalize(code));
}
