/**
 * Builds the public URL segment for a creator.
 *
 * Accent-folded and ASCII-only so the segment survives copying, sharing and
 * server logs unchanged. Uniqueness is a database concern, not this function's:
 * the caller appends a discriminator when the slug is taken.
 */
export const SLUG_MAX_LENGTH = 60;

export function slugify(input: string): string {
  const folded = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return folded.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "");
}

/**
 * The slug for a creator, falling back through the identifiers we have.
 * Returns `null` when nothing usable remains, so the caller must decide.
 */
export function creatorSlugCandidate(displayName: string, handle: string): string | null {
  const fromName = slugify(displayName);
  if (fromName !== "") {
    return fromName;
  }
  const fromHandle = slugify(handle);
  return fromHandle === "" ? null : fromHandle;
}

export function withSlugDiscriminator(slug: string, discriminator: number): string {
  const suffix = `-${discriminator}`;
  return `${slug.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/g, "")}${suffix}`;
}
