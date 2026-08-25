import {
  type AdminOperator,
  decodeOperators,
  encodeOperators,
  generateTotpSecret,
  hashPassword,
  isOperatorId,
  totpUri,
} from "../packages/config/src/index";

/**
 * Enrols a named administrator.
 *
 *   bun run admin:operator '<name>' '<password of at least 12 characters>'
 *
 * Prints the new `ADMIN_OPERATORS` value and the `otpauth://` URI to scan into
 * an authenticator app. The plaintext password never leaves this terminal and is
 * never stored anywhere: only the scrypt hash goes into the environment, and the
 * TOTP secret is shown once because it cannot be recovered later.
 *
 * An existing registry in `ADMIN_OPERATORS` is read and extended, so enrolling a
 * name that already exists is how a password or a lost second factor is rotated.
 * The other operators are carried through untouched — an enrolment that silently
 * dropped a colleague would lock them out at the worst possible moment.
 */
const [name, password] = process.argv.slice(2);

if (name === undefined || !isOperatorId(name)) {
  console.error(
    "Usage: bun run admin:operator '<name>' '<password>'\n" +
      "  The name is lowercase, 2-32 characters, letters digits . _ - only.",
  );
  process.exit(1);
}
if (password === undefined || password.length < 12) {
  console.error("The password must be at least 12 characters.");
  process.exit(1);
}

const existingRaw = process.env["ADMIN_OPERATORS"];
const existing: readonly AdminOperator[] =
  existingRaw === undefined || existingRaw.trim() === "" ? [] : decodeOperators(existingRaw);

const totpSecret = generateTotpSecret();
const enrolled: AdminOperator = { id: name, passwordHash: hashPassword(password), totpSecret };
const operators = [...existing.filter((operator) => operator.id !== name), enrolled];

const replaced = existing.some((operator) => operator.id === name);

console.info(
  `\n${replaced ? "Re-enrolled" : "Enrolled"} ${name}. ${operators.length} operator(s).`,
);
console.info("\nScan this in an authenticator app — it is shown once:\n");
console.info(`  ${totpUri({ secret: totpSecret, account: name, issuer: "Creator Outdoor" })}`);
console.info(`\n  (secret, if the app asks for it manually: ${totpSecret})`);
console.info("\nPut this in the environment of apps/admin:\n");
console.info(`ADMIN_OPERATORS=${encodeOperators(operators)}\n`);
