# 0004 — Shared contracts in TypeBox

**Status:** accepted

## Context

The API validates every external input at runtime, and `apps/web` needs the same shapes at
compile time. Database models must never be shared as API models.

## Decision

`packages/contracts` holds TypeBox schemas — Elysia's own type system — and the static types
they infer. Elysia consumes them directly for query and response validation; `apps/web`
validates API responses with `parseContract` before any field reaches a component.

Enum unions are written out as explicit literals rather than mapped from the domain arrays: a
`.map()` over an `as const` tuple widens `Static<>` to `string`, and the alternative would be a
type assertion. Instead `packages/contracts/test/enums.test.ts` proves at runtime that every
DTO union still matches the domain enum it mirrors, in the same order.

## Consequences

Adding a value to a domain enum without adding it to the contract fails a test rather than
silently widening a public type. Public DTOs stay explicit allowlists, so a new database column
cannot leak into an API response by default.

Zod is still used, but only in `packages/config` for environment parsing, where its ergonomics
around defaults and coercion fit better and no Elysia integration is needed.
