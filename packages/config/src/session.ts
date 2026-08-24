import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A signed, expiring session token.
 *
 * The administrator session lives in a secure HttpOnly cookie owned by
 * apps/admin. The token carries only an issue time, an expiry and a random
 * nonce — never a credential, and never anything the browser could replay
 * against the API.
 */
export type SessionPayload = {
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly nonce: string;
};

function base64url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64url(value: string): Buffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="), "base64");
}

function sign(payload: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(payload).digest());
}

export function createSessionToken(secret: string, ttlSeconds: number, now = Date.now()): string {
  const payload: SessionPayload = {
    issuedAt: now,
    expiresAt: now + ttlSeconds * 1000,
    nonce: base64url(randomBytes(12)),
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

/**
 * Verifies a token and returns its payload, or `null` for anything that is not
 * a currently valid session. Signature is checked before expiry, and the
 * comparison is timing-safe.
 */
export function readSessionToken(
  token: string,
  secret: string,
  now = Date.now(),
): SessionPayload | null {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) {
    return null;
  }
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  const expectedSignature = Buffer.from(sign(encoded, secret));
  const providedSignature = Buffer.from(signature);
  if (
    expectedSignature.length !== providedSignature.length ||
    !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(fromBase64url(encoded).toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("expiresAt" in payload) ||
    !("issuedAt" in payload) ||
    !("nonce" in payload)
  ) {
    return null;
  }
  const { issuedAt, expiresAt, nonce } = payload as Record<string, unknown>;
  if (typeof issuedAt !== "number" || typeof expiresAt !== "number" || typeof nonce !== "string") {
    return null;
  }
  return expiresAt > now ? { issuedAt, expiresAt, nonce } : null;
}
