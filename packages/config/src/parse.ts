import type { ZodType } from "zod";

/**
 * Raw environment shape. Every runtime hands us the same untyped bag of strings,
 * so business code never has to reach into `process.env` directly.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";

  constructor(label: string, issues: readonly string[]) {
    super(`Invalid ${label} configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
  }
}

/**
 * Parses a value against a schema and throws immediately when it is invalid.
 * Applications call this at startup so a misconfigured process never boots.
 */
export function parseOrThrow<TOutput>(
  schema: ZodType<TOutput>,
  value: unknown,
  label: string,
): TOutput {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
  throw new ConfigurationError(label, issues);
}
