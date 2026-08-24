/** The longest bio a profile shows. Matches the column and the contract. */
export const CREATOR_BIO_MAX = 500;

export class InvalidCreatorBioError extends Error {
  override readonly name = "InvalidCreatorBioError";
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * What a claimed creator may put on their own page.
 *
 * Plain text, always. The bio is rendered as text and never as markup, so this
 * is not an escaping step — it is about what the page should look like: no
 * control characters, no run of blank lines someone pasted from elsewhere, and
 * a length the layout can actually hold.
 */
export function sanitizeCreatorBio(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value.length > CREATOR_BIO_MAX) {
    throw new InvalidCreatorBioError(`A bio aceita no maximo ${CREATOR_BIO_MAX} caracteres`);
  }

  const cleaned = value
    .replace(CONTROL_CHARACTERS, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
  return cleaned.length === 0 ? null : cleaned;
}
