# 0001 — Bun workspace monorepo with Turborepo

**Status:** accepted

## Context

Creator Outdoor is one product with a public web app, an administration app and an
authoritative API that share business rules, contracts and configuration. Those rules —
ranking order, money handling, period boundaries — must have exactly one implementation.

## Decision

A single Bun workspace monorepo (`apps/*`, `packages/*`) orchestrated with Turborepo.

- Bun `1.3.14` is pinned in `packageManager` and `.bun-version`. There is one authoritative
  `bun.lock`; npm, yarn and pnpm lockfiles are never introduced.
- Node.js `24.19.0` LTS is pinned in `.nvmrc` for Node-only tooling: Playwright now, StrykerJS
  later. Node 20 is not used.
- Biome `2.5.10` is the single formatter, linter and import organizer. ESLint and Prettier are
  not installed; adding either requires an ADR documenting an unavoidable incompatibility.
- Husky and lint-staged keep pre-commit fast (Biome on staged files only). Pre-push runs
  `typecheck` and `test:unit`; the E2E suite deliberately does not run on every commit.
- Dependencies are pinned exactly. No `^`, `~` or `latest` on production dependencies.

## Consequences

Shared rules cannot drift between applications. Turborepo caches builds, typechecks and unit
tests; integration and E2E tasks are uncached because they touch a real database and a browser.

Turborepo is not a reason to over-fragment packages: a new package needs a boundary worth
enforcing, not merely a folder worth naming.
