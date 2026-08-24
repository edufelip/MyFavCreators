# 0009 — A `jsonb` column type that stores JSON objects

**Status:** accepted

## Context

`payments.raw_metadata`, `payment_events.payload` and `audit_logs.metadata` are
`jsonb`. Written through Drizzle's built-in `jsonb()` on the Bun SQL driver, every
one of them was stored as a JSON **string containing JSON**:

```sql
select jsonb_typeof(raw_metadata) from payments;  -- 'string', not 'object'
select raw_metadata->>'origin'   from payments;   -- null, for every key
```

Drizzle serializes the value before handing it to the driver, and Bun's SQL driver
serializes objects itself. Two layers each doing the right thing produced the
wrong result, and nothing failed: writes succeeded, reads round-tripped through
`JSON.parse`, and the corruption was invisible until a checkout tried to read one
field back out.

The real cost is silent. Every `->>` lookup returns null, so no query can filter
on a payment's origin, no GIN index on the column can ever match, and an operator
reading the audit log sees escaped noise.

## Decision

A `jsonbObject` custom column type in `packages/db/src/schema/columns.ts` that
passes the object straight to the driver and accepts either shape on read. Every
`jsonb` column uses it; the built-in `jsonb()` is not used anywhere.

The column type is unchanged at the DDL level, so no migration was required.

## Consequences

`jsonb_typeof` is `object` and `->>` works, so the data is queryable and
indexable. Integration tests assert that directly for payments, payment events and
audit entries rather than only asserting a round trip, because a round trip is
exactly what did not catch this.

Reads still accept a string, because Drizzle's query builder parses `jsonb` while
a raw `execute` returns it as text — `readJsonObject` in `packages/db/src/row.ts`
normalizes both, and is unit-tested for both.
