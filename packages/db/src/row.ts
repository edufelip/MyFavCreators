import { type MoneyCents, parseMoneyCents } from "@creator-outdoor/domain";

export class DatabaseRowError extends Error {
  override readonly name = "DatabaseRowError";
}

/**
 * The database driver hands back untyped rows. Every value is validated here
 * before it reaches typed code, so a schema drift surfaces as a clear error
 * instead of an implicit `any` travelling into a public response.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DatabaseRowError(`Expected a row object, received: ${typeof value}`);
  }
  return value;
}

export function requireString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new DatabaseRowError(`Column "${key}" should be a string, received: ${typeof value}`);
  }
  return value;
}

export function optionalString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new DatabaseRowError(`Column "${key}" should be a string or null`);
  }
  return value;
}

export function requireInteger(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed)) {
    throw new DatabaseRowError(`Column "${key}" should be an integer, received: ${String(value)}`);
  }
  return parsed;
}

export function requireMoneyCents(row: Record<string, unknown>, key: string): MoneyCents {
  return parseMoneyCents(row[key]);
}

export function requireDate(row: Record<string, unknown>, key: string): Date {
  const value = row[key];
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  throw new DatabaseRowError(`Column "${key}" should be a timestamp, received: ${String(value)}`);
}

export function optionalDate(row: Record<string, unknown>, key: string): Date | null {
  const value = row[key];
  return value === null || value === undefined ? null : requireDate(row, key);
}

export function requireEnum<const TValues extends readonly string[]>(
  row: Record<string, unknown>,
  key: string,
  allowed: TValues,
): TValues[number] {
  const value = row[key];
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value;
  }
  throw new DatabaseRowError(`Column "${key}" should be one of ${allowed.join(", ")}`);
}

export function optionalEnum<const TValues extends readonly string[]>(
  row: Record<string, unknown>,
  key: string,
  allowed: TValues,
): TValues[number] | null {
  const value = row[key];
  return value === null || value === undefined ? null : requireEnum(row, key, allowed);
}

/**
 * Reads a `jsonb` column from a raw SQL result.
 *
 * Drizzle's query builder parses `jsonb` for you, but `execute` with a raw
 * statement hands the column back as a JSON *string*. Treating the two paths
 * alike here means a repository that switches between them cannot silently
 * start seeing `{}` where it expected data.
 */
export function readJsonObject(row: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = row[key];
  if (isRecord(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      throw new DatabaseRowError(`Column "${key}" is not valid JSON`);
    }
  }
  if (value === null || value === undefined) {
    return {};
  }
  throw new DatabaseRowError(`Column "${key}" should be a JSON object`);
}
