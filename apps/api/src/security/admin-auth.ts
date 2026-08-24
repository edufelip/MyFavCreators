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
