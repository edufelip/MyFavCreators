import { z } from "zod";
import { verifyPassword } from "./password";
import { decodeBase32 } from "./totp";

/**
 * The named administrators.
 *
 * V1 does not warrant an identity provider, but it does warrant knowing *who*
 * removed a creator or refunded a payment. A shared password cannot answer that
 * question, and an audit trail that names everybody "admin" is not an audit
 * trail. Each operator therefore has their own password hash and their own
 * second factor, and their identifier is what the audit log records.
 *
 * The registry is carried as one base64url-encoded JSON document in
 * `ADMIN_OPERATORS`. That is deliberate: the value lives in a file people
 * `source`, so an encoding with no shell metacharacters in it cannot be
 * silently mangled between the file and the process. `bun run admin:operator`
 * produces it.
 */
export type AdminOperator = {
  readonly id: string;
  readonly passwordHash: string;
  readonly totpSecret: string;
};

/**
 * Lowercase, at least two characters, and no whitespace.
 *
 * The identifier is an audit-log primary key in practice, so two operators must
 * never be able to pick names that read as the same person.
 */
const OPERATOR_ID = /^[a-z0-9][a-z0-9._-]{1,31}$/;

/** 128 bits, the RFC 4226 minimum. */
const MINIMUM_SECRET_BYTES = 16;

export function isOperatorId(value: string): boolean {
  return OPERATOR_ID.test(value);
}

const operatorSchema = z.object({
  id: z.string().regex(OPERATOR_ID, "operator id must be lowercase, 2-32 characters"),
  passwordHash: z.string().min(16, "operator password hash is required"),
  totpSecret: z
    .string()
    .min(1, "operator TOTP secret is required")
    .refine((secret) => {
      try {
        return decodeBase32(secret).length >= MINIMUM_SECRET_BYTES;
      } catch {
        return false;
      }
    }, "operator TOTP secret must be at least 128 bits of base32"),
});

const registrySchema = z
  .array(operatorSchema)
  .min(1, "at least one administrator is required")
  .refine(
    (operators) => new Set(operators.map((operator) => operator.id)).size === operators.length,
    "operator ids must be unique",
  );

/**
 * The password `.env.example` documents, in plain text and on purpose.
 *
 * The neighbouring secrets say `change-me` in their own text; the registry is
 * an opaque base64 document, so somebody rotating the obvious ones has no cue
 * that the third is a publicly known password and TOTP seed for an operator who
 * can issue refunds.
 *
 * The password rather than its hash, because scrypt salts: `bun run
 * admin:operator 'edu' 'creator-outdoor-dev'` produces a different hash string
 * for the same public password, and comparing the serialized hash would wave it
 * straight through. Re-enrolling the example operator is exactly what somebody
 * setting up a deployment does.
 */
const PUBLISHED_EXAMPLE_PASSWORD = "creator-outdoor-dev";

/**
 * The TOTP seed `.env.example` ships, which is the other half of the account.
 *
 * Checked separately, because rotating one credential and not the other is the
 * likely mistake rather than an unlikely one. Somebody who reads "this operator
 * is public" changes the password; the seed is an opaque base32 string two
 * lines down that looks like it was generated for them. Keeping it means the
 * second factor — the thing that is supposed to make a leaked password
 * survivable — is printed in this repository.
 */
const PUBLISHED_EXAMPLE_TOTP_SECRET = "QSRZQA4PSAPBBEK7ERZEBDTIBWXXEJUV";

/**
 * Whether either of this operator's factors is the one published here.
 *
 * Asked of one operator rather than of the registry, and that is the whole
 * point. "Does the file still contain the example?" can only be answered by
 * refusing everything, which takes a working admin app down over a stale entry
 * that may grant nothing. "May this credential sign in?" refuses exactly the
 * operator whose secrets are public, and leaves every real operator alongside
 * it working.
 *
 * Either factor, not both: an account with one public factor has one factor,
 * and this exists precisely because a single leaked credential should not be
 * enough to approve creators and issue refunds.
 *
 * The password is compared through `verifyPassword` rather than by its hash,
 * because scrypt salts — `bun run admin:operator 'edu' 'creator-outdoor-dev'`
 * produces a different hash string for the same public password, and comparing
 * the serialized hash waved it straight through.
 */
export function usesPublishedExampleCredentials(operator: AdminOperator): boolean {
  return (
    verifyPassword(PUBLISHED_EXAMPLE_PASSWORD, operator.passwordHash) ||
    operator.totpSecret.replace(/[\s=]/g, "").toUpperCase() === PUBLISHED_EXAMPLE_TOTP_SECRET
  );
}

export function encodeOperators(operators: readonly AdminOperator[]): string {
  return Buffer.from(JSON.stringify(operators), "utf8").toString("base64url");
}

/**
 * Decodes and validates the registry, throwing on anything short of a complete,
 * well-formed set. A deployment whose operator list is unreadable must refuse to
 * start rather than come up with nobody — or, worse, with an operator whose
 * second factor silently fails open.
 */
export function decodeOperators(encoded: string): readonly AdminOperator[] {
  if (encoded.trim() === "") {
    throw new Error("ADMIN_OPERATORS is empty");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("ADMIN_OPERATORS is not base64url-encoded JSON");
  }

  const result = registrySchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `ADMIN_OPERATORS is invalid: ${result.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return result.data;
}

/**
 * Finds an operator by exact identifier.
 *
 * The match is case-sensitive and there is no fallback: an unknown name is
 * nobody, never a default administrator.
 */
export function findOperator(
  operators: readonly AdminOperator[],
  id: string,
): AdminOperator | null {
  return operators.find((operator) => operator.id === id) ?? null;
}
