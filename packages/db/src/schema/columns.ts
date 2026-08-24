import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

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
