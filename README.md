# Creator Outdoor

A public digital billboard where money purchases measurable prominence for creator discovery.

People pay to give visibility to creator profiles. Creators receiving the highest total value
of confirmed boosts rank highest and receive the most prominent positions on the platform.
The business model is advertising: the platform sells display space, prominence and measurable
visibility on Creator Outdoor.

**No money is transferred to creators.** Creator Outdoor is not crowdfunding, donations,
tipping or financial support for creators, and it never sells followers, likes, views or any
external engagement. See [`docs/product.md`](docs/product.md).

## Status

**Phases 1–2 complete.** The public leaderboard, the current #1 billboard, creator pages, the
weekly countdown and the Take #1 calculation are live, and creators can be submitted,
moderated, reported and removed. There is no payment flow yet; see
[Phase boundaries](#phase-boundaries).

## Requirements

| Tool | Version | Why |
| --- | --- | --- |
| [Bun](https://bun.sh) | `1.3.14` (pinned in `.bun-version` and `packageManager`) | Package manager, test runner, and the API runtime |
| [Node.js](https://nodejs.org) | `24.19.0` LTS (pinned in `.nvmrc`) | Node-only tooling: Playwright, and later StrykerJS |
| [Docker](https://docs.docker.com/compose/) | any recent version | Local PostgreSQL 18 |

## Local setup

```bash
cp .env.example .env      # adjust if your ports differ
bun install
bun run db:up             # starts postgres:18.6-alpine on :5432
bun run db:migrate        # applies the committed migrations
bun run db:seed           # 13 categories, 15 fictional creators, confirmed boosts
bun run dev               # web :3000, api :3001, admin :3002
```

Then open <http://localhost:3000>.

| Application | Port | Purpose |
| --- | --- | --- |
| `apps/web` | 3000 | Public Creator Outdoor product |
| `apps/api` | 3001 | Authoritative backend (the only application that reaches PostgreSQL) |
| `apps/admin` | 3002 | Internal administration (placeholder until Phase 2) |
| PostgreSQL | 5432 | Local database |

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | Runs every application in watch mode |
| `bun run build` | Production build of every application |
| `bun run check` | Biome: formatting, lint and import order |
| `bun run check:fix` | Biome with fixes applied |
| `bun run typecheck` | `tsc --noEmit` across the workspace |
| `bun run test:unit` | Domain, contracts, API and component unit tests |
| `bun run test:integration` | API tests against a real PostgreSQL database |
| `bun run test:e2e` | Playwright smoke suite against the built stack |
| `bun run db:up` / `db:down` | Starts / stops the local PostgreSQL container |
| `bun run db:generate` | Generates a migration from schema changes |
| `bun run db:migrate` | Applies committed migrations |
| `bun run db:seed` | Replaces fixture data (refuses to run with `NODE_ENV=production`) |
| `bun run db:reset` | Drops the schema and re-applies migrations |
| `bun run admin:hash '<password>'` | Prints the `ADMIN_PASSWORD_HASH` value for a password |

Migrations are explicit artifacts and are deliberately **not** part of `build`. Production
schema changes happen through a separate deployment step.

## Repository layout

```
apps/
  web/        Next.js 16 public product          -> HTTP to apps/api
  admin/      Next.js 16 administration          -> HTTP to apps/api
  api/        Elysia on Bun, authoritative       -> PostgreSQL
packages/
  contracts/  Shared API contracts (TypeBox DTOs)
  domain/     Pure business rules, zero infrastructure
  db/         Drizzle schema, migrations, repositories, seed
  config/     Zod environment parsing and typed configuration
  testkit/    Factories, fixtures and database helpers for tests
docs/
  product.md, architecture.md, decisions/
```

`apps/web` and `apps/admin` never import Drizzle or a database schema. All business data
comes from `apps/api`. See [`docs/architecture.md`](docs/architecture.md).

## Testing

```bash
bun run test:unit                     # no database required
bun run db:up && bun run db:migrate
bun run test:integration              # uses TEST_DATABASE_URL, falls back to DATABASE_URL
bun run test:e2e                      # builds apps/web, boots the stack, drives a browser
```

Integration tests run against a real PostgreSQL database and never mock it: ranking rules
live partly in SQL and in database constraints, which a fake would not exercise.

## Administration

`apps/admin` on port 3002 owns the administrator session. Sign in with the password whose
scrypt hash is in `ADMIN_PASSWORD_HASH` (the development value is `creator-outdoor-dev`).
Generate a real one with `bun run admin:hash '<password>'`; the plaintext never leaves your
terminal.

The browser only ever talks to the admin Next.js server. Every mutation is a server-to-server
call into the API's `/internal/admin/*` surface, authenticated with `ADMIN_API_SECRET`, which
the browser never receives.

## Phase boundaries

Not yet implemented:

- PIX payments, the fake PIX provider, boost creation and checkout (Phase 3)
- Rotation, sharing, dynamic OG images, the overtake ticker and weekly rollover (Phase 4)
- The public rules page, which arrives with the boost flow it has to explain
- Boost calls to action render disabled with an "Em breve" state until Phase 3

The mandatory `<BoostDisclosure />` component already exists with its exact wording so that
Phase 3 only has to place it on the four surfaces that require it.
