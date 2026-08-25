import { timingSafeEqual } from "node:crypto";

export const ADMIN_SECRET_HEADER = "x-admin-api-secret";

/**
 * Compares two secrets without leaking their similarity through timing.
 *
 * Length is compared first because `timingSafeEqual` throws on a mismatch; the
 * length of a secret is not the part worth hiding.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (providedBytes.length !== expectedBytes.length) {
    return false;
  }
  return timingSafeEqual(providedBytes, expectedBytes);
}

/**
 * Authorizes an internal admin call.
 *
 * The secret is server-only: apps/admin holds it and calls the API
 * server-to-server. A browser never receives it, so it never travels in a page,
 * a bundle or a client fetch.
 */
export function isAuthorizedAdminRequest(request: Request, expectedSecret: string): boolean {
  if (expectedSecret === "") {
    return false;
  }
  const provided = request.headers.get(ADMIN_SECRET_HEADER);
  return provided !== null && secretsMatch(provided, expectedSecret);
}

export const ADMIN_ACTOR_HEADER = "x-admin-actor";

/**
 * Lowercase, at least two characters, no whitespace — the same shape
 * `packages/config` enforces when an operator is enrolled.
 */
const OPERATOR_ID = /^[a-z0-9][a-z0-9._-]{1,31}$/;

/**
 * Reads the operator behind an internal admin call.
 *
 * apps/admin holds the shared secret and takes this value from a signed session
 * cookie, so by the time it reaches here it is an authenticated assertion from a
 * trusted server — but its *shape* is still checked, because a value that ends
 * up in the audit log unvalidated is a value somebody can use to make the log
 * say whatever they like.
 *
 * There is deliberately no fallback. An action nobody is willing to sign for is
 * refused, not filed under a shared account.
 */
export function readAdminActor(request: Request): string | null {
  const provided = request.headers.get(ADMIN_ACTOR_HEADER);
  return provided !== null && OPERATOR_ID.test(provided) ? provided : null;
}
