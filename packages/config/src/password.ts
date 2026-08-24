import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing for the single V1 administrator.
 *
 * A full customer identity provider is not warranted for one operator, but the
 * password still never appears in plaintext anywhere: the deployment stores a
 * scrypt hash, and verification is timing-safe.
 *
 * The encoding is deliberately shell-safe — colon separators and base64url —
 * because this value lives in an environment file that people `source`, and a
 * `$` or `/` in it would be silently mangled by the shell before the process
 * ever saw it.
 */
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const derived = scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
  });
  return [
    "scrypt",
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELISM,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join(":");
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a misconfigured
 * deployment must fail closed, never open.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }
  const [, costRaw, blockRaw, parallelRaw, saltRaw, keyRaw] = parts;
  const cost = Number.parseInt(costRaw ?? "", 10);
  const blockSize = Number.parseInt(blockRaw ?? "", 10);
  const parallelism = Number.parseInt(parallelRaw ?? "", 10);
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelism)) {
    return false;
  }

  let expected: Buffer;
  try {
    expected = Buffer.from(keyRaw ?? "", "base64url");
    if (expected.length === 0) {
      return false;
    }
  } catch {
    return false;
  }

  try {
    const derived = scryptSync(
      password.normalize("NFKC"),
      Buffer.from(saltRaw ?? "", "base64url"),
      expected.length,
      { N: cost, r: blockSize, p: parallelism },
    );
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
