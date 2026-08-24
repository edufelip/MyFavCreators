import { hashPassword } from "../packages/config/src/password";

/**
 * Produces the value for ADMIN_PASSWORD_HASH.
 *
 * The plaintext password never leaves the operator's terminal and is never
 * stored anywhere: only the scrypt hash goes into the environment.
 *
 *   bun run admin:hash 'a strong password'
 */
const password = process.argv[2];
if (password === undefined || password.length < 12) {
  console.error("Usage: bun run admin:hash '<password of at least 12 characters>'");
  process.exit(1);
}

console.info(hashPassword(password));
