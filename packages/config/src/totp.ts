import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords, RFC 6238.
 *
 * A password alone is a single stolen string away from full moderation
 * authority: approve, remove, refund. The second factor is what stops a leaked
 * `.env`, a shoulder-surfed login or a reused password from being enough.
 *
 * The parameters are the ones every authenticator app assumes by default —
 * SHA-1, six digits, thirty seconds — because the operator enrols by scanning a
 * URI, and an app that has to be told about a non-default algorithm is an app
 * that will silently produce wrong codes for somebody.
 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DIGITS = 6;
const STEP_SECONDS = 30;
const SECRET_BYTES = 20;

/** How many steps either side of now are accepted, for clock drift. */
const DRIFT_STEPS = 1;

export function encodeBase32(bytes: Uint8Array): string {
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  }
  return output;
}

/**
 * Decodes base32, tolerating the way a person retypes a secret: lowercase,
 * spaces, and the padding an authenticator app sometimes shows.
 *
 * Throws on any other character. A secret that decoded a typo into different
 * bytes would lock an operator out with no way to tell why.
 */
export function decodeBase32(encoded: string): Uint8Array {
  const cleaned = encoded.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of cleaned) {
    const value = BASE32_ALPHABET.indexOf(character);
    if (value < 0) {
      throw new Error("Invalid base32 character");
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  return Uint8Array.from(bytes);
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(SECRET_BYTES));
}

/**
 * The code for one counter step. Exported so tests can assert against the RFC
 * vectors and the enrolment script can show the operator a first code.
 */
export function totpCodeAt(secret: string, counter: number): string {
  const key = decodeBase32(secret);
  if (key.length === 0) {
    throw new Error("Empty TOTP secret");
  }

  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();

  // RFC 4226 dynamic truncation: the low nibble of the last byte picks the
  // four-byte window, and the top bit is masked off so the result is positive
  // on every implementation regardless of signedness.
  const offset = (digest[digest.length - 1] ?? 0) & 15;
  const binary =
    (((digest[offset] ?? 0) & 127) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Verifies a code and returns the counter step it matched, or `null`.
 *
 * The step is returned rather than a boolean so the caller can refuse to accept
 * the same code twice: within a thirty-second window a code observed over the
 * operator's shoulder — or replayed from a proxy log — is otherwise still valid.
 *
 * A malformed secret returns `null` rather than throwing: a misconfigured
 * operator entry must fail closed, never open.
 */
export function verifyTotp(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) {
    return null;
  }

  let key: Uint8Array;
  try {
    key = decodeBase32(secret);
  } catch {
    return null;
  }
  if (key.length === 0) {
    return null;
  }

  const current = Math.floor(now / (STEP_SECONDS * 1000));
  const provided = Buffer.from(code, "utf8");
  let matched: number | null = null;
  // Every candidate step is checked even after a match, so the time taken does
  // not reveal which step was the right one.
  for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step += 1) {
    const expected = Buffer.from(totpCodeAt(secret, step), "utf8");
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
      matched = step;
    }
  }
  return matched;
}

/** The counter step a timestamp falls in, for replay bookkeeping. */
export function totpStep(now = Date.now()): number {
  return Math.floor(now / (STEP_SECONDS * 1000));
}

/**
 * The `otpauth://` URI an operator scans to enrol.
 *
 * Every parameter is written out explicitly, including the ones that match the
 * defaults, because an app that guesses differently produces codes this server
 * will reject and neither side can see why.
 */
export function totpUri(input: {
  readonly secret: string;
  readonly account: string;
  readonly issuer: string;
}): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const parameters = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${parameters.toString()}`;
}
