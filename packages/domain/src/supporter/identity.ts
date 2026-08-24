import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * How supporters are identified.
 *
 * Accounts are not required to boost, so identity has to come from somewhere
 * else — and it must never come from the display name, which is not unique and
 * would merge two different people who both call themselves "Marina".
 *
 * Two separate identifiers exist on purpose:
 *
 * - `supporterKey` is a persistent browser identifier for the supporter. It is
 *   **not** the analytics `sid`: mixing them would let analytics deduplication
 *   reshape who counts as a supporter, and would leak one system's identifiers
 *   into the other.
 * - `fanIdentityKey` is what the Torcida groups by. It is derived with an HMAC
 *   so the stored value reveals nothing: a plain unsalted email hash would be
 *   trivially reversible against a list of addresses.
 *
 * Neither value is ever exposed publicly.
 */
export const SUPPORTER_KEY_BYTES = 16;

/**
 * The canonical form of an email for identity purposes.
 *
 * Deliberately conservative: case and surrounding whitespace only. Provider
 * quirks like dot-insensitivity are not applied, because merging two addresses
 * that a provider happens to treat alike would merge two people the platform
 * has no right to merge.
 */
export function normalizeEmailForIdentity(email: string): string {
  return email.trim().toLowerCase();
}

export type FanIdentityInput = {
  readonly secret: string;
  /** Preferred when present: the same person on a new device stays one supporter. */
  readonly email?: string | null | undefined;
  readonly supporterKey: string;
};

/**
 * The grouping key for a supporter.
 *
 * An email, when given, wins over the browser key so someone who boosts from a
 * phone and then a laptop is one supporter rather than two. The two inputs are
 * domain-separated so a `supporterKey` can never collide with an email hash.
 */
export function deriveFanIdentityKey(input: FanIdentityInput): string {
  if (input.secret.length < 32) {
    throw new RangeError("The fan identity secret must be at least 32 characters");
  }
  const normalizedEmail =
    input.email === null || input.email === undefined || input.email.trim() === ""
      ? null
      : normalizeEmailForIdentity(input.email);
  const material =
    normalizedEmail === null ? `supporter:${input.supporterKey}` : `email:${normalizedEmail}`;
  return createHmac("sha256", input.secret).update(material).digest("hex");
}

/** Constant-time comparison, for the rare case two keys are compared directly. */
export function fanIdentityKeysMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
