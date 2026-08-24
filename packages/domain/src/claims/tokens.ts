import { createHash, randomBytes } from "node:crypto";

/** 32 bytes of randomness, which is 43 characters of base64url. */
export const CLAIM_TOKEN_LENGTH = 43;

/** Below this a value cannot be a token this system issued. */
const MIN_HASHABLE_LENGTH = 20;

/**
 * The secret that proves somebody verified a claim.
 *
 * Random rather than derived: a token computed from the creator would let
 * anybody holding one work out another, and this token is the whole of the
 * authority to edit a profile.
 */
export function createClaimToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * What the database stores.
 *
 * A plain SHA-256 with no secret, which is right here and would be wrong for a
 * password: the token is 256 bits of uniform randomness, so there is nothing to
 * guess and no dictionary to run. What this buys is that a leaked dump hands
 * nobody control of a profile.
 *
 * Refuses anything too short to be one of our tokens, so an empty or truncated
 * value cannot be hashed into a lookup that might match a row.
 */
export function hashClaimToken(token: string): string {
  if (token.length < MIN_HASHABLE_LENGTH) {
    throw new RangeError("A claim token is longer than this");
  }
  return createHash("sha256").update(token).digest("hex");
}
