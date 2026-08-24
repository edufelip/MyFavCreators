import { sql } from "drizzle-orm";
import { customType, timestamp, uuid } from "drizzle-orm/pg-core";

/** Every primary key is a database-generated UUID. */
export const primaryKeyColumn = () => uuid("id").primaryKey().defaultRandom();

/**
 * Real-world instants are always `timestamptz`. Wall-clock rendering happens at
 * the presentation layer using the configured IANA time zone.
 */
export const timestampColumn = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const createdAtColumn = () => timestampColumn("created_at").notNull().default(sql`now()`);
export const updatedAtColumn = () => timestampColumn("updated_at").notNull().default(sql`now()`);

/**
 * A `jsonb` column that stores an actual JSON object.
 *
 * Drizzle's built-in `jsonb()` serializes the value to a string before handing
 * it to the driver, and Bun's SQL driver serializes objects itself — so the two
 * together store a JSON *string* containing JSON. The column then reports
 * `jsonb_typeof = 'string'`, and `metadata->>'key'` is null for every key,
 * which quietly makes the data unqueryable and unindexable.
 *
 * Passing the object straight through stores a real object. Reads accept both
 * shapes, because the query builder and a raw `execute` differ on that too.
 */
export const jsonbObject = customType<{
  data: Record<string, unknown>;
  driverData: unknown;
}>({
  dataType: () => "jsonb",
  toDriver: (value) => value,
  fromDriver: (value) => {
    if (typeof value === "string") {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    }
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  },
});
