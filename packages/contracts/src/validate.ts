import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/**
 * A contract schema, and the shape it validates to.
 *
 * Re-exported so a consumer can write a helper that is generic over a contract
 * without depending on TypeBox itself — and, more to the point, without falling
 * back on a cast to say "this is the type I asked for".
 */
export type { Static, TSchema };
export type ContractOf<TSchemaType extends TSchema> = Static<TSchemaType>;

export class ContractViolationError extends Error {
  override readonly name = "ContractViolationError";

  constructor(label: string, issues: readonly string[]) {
    super(
      `Payload does not satisfy the ${label} contract:\n${issues.map((i) => `  - ${i}`).join("\n")}`,
    );
  }
}

/** Whether a caught value is a contract violation rather than any other fault. */
export function isContractViolation(error: unknown): error is ContractViolationError {
  return error instanceof ContractViolationError;
}

/**
 * Validates an untrusted payload against a contract.
 *
 * Used wherever data crosses a boundary the type system cannot police — an HTTP
 * response read by apps/web, a fixture, a provider payload. Frontend types are
 * never runtime validation.
 */
export function parseContract<TSchemaType extends TSchema>(
  schema: TSchemaType,
  value: unknown,
  label: string,
): import("@sinclair/typebox").Static<TSchemaType> {
  if (Value.Check(schema, value)) {
    return value;
  }
  const issues = [...Value.Errors(schema, value)]
    .slice(0, 10)
    .map((error) => `${error.path === "" ? "(root)" : error.path}: ${error.message}`);
  throw new ContractViolationError(label, issues);
}

export function matchesContract<TSchemaType extends TSchema>(
  schema: TSchemaType,
  value: unknown,
): value is import("@sinclair/typebox").Static<TSchemaType> {
  return Value.Check(schema, value);
}
