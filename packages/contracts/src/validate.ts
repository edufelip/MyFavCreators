import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export class ContractViolationError extends Error {
  override readonly name = "ContractViolationError";

  constructor(label: string, issues: readonly string[]) {
    super(
      `Payload does not satisfy the ${label} contract:\n${issues.map((i) => `  - ${i}`).join("\n")}`,
    );
  }
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
