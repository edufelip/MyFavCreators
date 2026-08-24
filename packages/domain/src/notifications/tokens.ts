import { randomBytes } from "node:crypto";

/** 32 bytes of randomness, which is 43 characters of base64url. */
export const UNSUBSCRIBE_TOKEN_LENGTH = 43;

/**
 * The secret in a one-click unsubscribe link.
 *
 * Random rather than derived: a token computed from the subscription would let
 * anyone holding one work out another, and the whole point is that following
 * the link in your own email can only ever unsubscribe you.
 *
 * URL-safe because it travels in a link that mail clients rewrite, wrap and
 * sometimes re-encode.
 */
export function createUnsubscribeToken(): string {
  return randomBytes(32).toString("base64url");
}
