import { z } from "zod";
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
 * The password hash `.env.example` ships.
 *
 * The neighbouring secrets say `change-me` in their own text; this one is an
 * opaque base64 document, so somebody rotating the obvious ones has no cue that
 * the third is a publicly known password and TOTP seed for an operator who can
 * issue refunds.
 */
const PUBLISHED_EXAMPLE_HASH =
  "scrypt:16384:8:1:OkqxKa7iUEjmq3If6l1SWA:cps2SknbPo1f2EylWCDts-N-647wGqaX7blQstoAfhcWto57sMe5YXEGaVziVuDEai3HXIUcFJNO6kCE0rjwLA";

/**
 * Whether this operator's credentials are the ones published in this repository.
 *
 * Asked of one operator rather than of the registry, and that is the whole
 * point. "Does the file still contain the example?" can only be answered by
 * refusing everything, which takes a working admin app down over a stale entry
 * that may grant nothing. "May this credential sign in?" refuses exactly the
 * operator whose password is public, and leaves every real operator alongside
 * it working.
 */
export function usesPublishedExampleCredentials(operator: AdminOperator): boolean {
  return operator.passwordHash === PUBLISHED_EXAMPLE_HASH;
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
