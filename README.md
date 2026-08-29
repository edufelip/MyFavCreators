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

**Phases 1–8 complete.** The public leaderboard, the current #1 billboard, creator pages, the
weekly countdown and the Take #1 calculation are live; creators can be submitted, moderated,
reported and removed; and the full boost loop runs end to end — checkout with QR and
copia-e-cola, webhook confirmation, transactional activation, real rank movement and refunds.
The live loop is closed: fair rotation, the overtake ticker, dynamic share cards, heat mode and
an idempotent weekly rollover. Payments run against a real PIX provider when credentials are
set, with signed webhooks, replay protection and a reconciliation job that recovers payments
whose webhook never arrived. Creator pages carry the Torcida, delivery is measured through
impressions and tracked outbound clicks, and supporters who leave an address hear when the
creator they follow loses the top spot. Creators can claim their own profile with a code in the
bio, edit it, read their delivery numbers, embed a rank badge and appear in the Hall da Fama.
Logging is
structured and correlated by request id, the domain rules are mutation-tested, and the public
pages pass a WCAG 2.1 AA scan. See [Phase boundaries](#phase-boundaries) for the open items.

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
bun run db:seed           # 13 categories, 15 creators, boosts, and six closed weeks
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
| `bun run db:seed` | Replaces fixture data and closes the weeks it invents, so the Hall da Fama has history (refuses to run with `NODE_ENV=production`) |
| `bun run db:reset` | Drops the schema and re-applies migrations |
| `bun run admin:operator '<name>' '<password>'` | Enrols an administrator: prints the new `ADMIN_OPERATORS` value and the `otpauth://` URI to scan |
| `bun run job:weekly-rollover` | Closes finished weeks and snapshots their rankings |

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
bun run job:weekly-rollover           # closed weeks, which the Hall da Fama tests need
bun run test:e2e                      # builds apps/web, boots the stack, drives a browser
```

Integration tests run against a real PostgreSQL database and never mock it: ranking rules
live partly in SQL and in database constraints, which a fake would not exercise.

Two things about the E2E suite are worth knowing before it misleads you. Locally, Playwright
reuses a server already listening on the port — so a stack left running from an earlier session
will happily serve an **old build**, and the suite will report on code you are not looking at.
Stop any leftovers first, or let a run finish on its own rather than killing servers as you
launch the next one. And the suite runs on a single worker on purpose: the ranking is global
state, and a TOTP code may be used once, so two workers signing into the admin app inside the
same thirty seconds make each other fail.

## Mutation and accessibility

`bun run test:mutation` mutates the domain rules where a wrong answer costs money or exposes
somebody, and fails under 80%. It is what surfaced that a zero-padded numeric host could be
read as octal here and decimal by whatever resolves it later.

The accessibility scan runs inside the Playwright suite (`e2e/accessibility.spec.ts`) against
the real rendered pages, at WCAG 2.1 A and AA.

## Administration

`apps/admin` on port 3002 owns the administrator session. Sign in with an operator name, that
person's password, and the six-digit code from their authenticator app. The development
operator is `edu` / `creator-outdoor-dev`, and its TOTP secret is in `E2E_ADMIN_TOTP_SECRET`.

Enrol a real one with `bun run admin:operator '<name>' '<password>'`. It prints the new
`ADMIN_OPERATORS` value and an `otpauth://` URI to scan; the plaintext password never leaves
your terminal and the TOTP secret is shown once. Pass the existing `ADMIN_OPERATORS` in the
environment to add somebody to it, or to rotate a name that is already there.

Every action is recorded in the audit log under the operator's own name, including refunds,
which the payments screen at `/pagamentos` can issue. A refund sends money back to whoever paid
it — no money reaches a creator on that path or on any other.

The browser only ever talks to the admin Next.js server. Every mutation is a server-to-server
call into the API's `/internal/admin/*` surface, authenticated with `ADMIN_API_SECRET`, which
the browser never receives.

## Trying the boost flow locally

The fake PIX provider settles nothing, and its simulation surface is mounted **only** outside
production:

```bash
# Start a boost from the UI, then read its provider payment id:
curl localhost:3001/dev/pix/lookup/<paymentId>

# Settle it the way a provider would (CONFIRMED, FAILED, EXPIRED, REFUNDED, ...):
curl -X POST localhost:3001/dev/pix/<providerPaymentId>/CONFIRMED
```

The simulation delivers a properly signed webhook to the real webhook route, so the local flow
exercises the same authentication and the same idempotency the production one will.

## Scheduled jobs

`bun run job:weekly-rollover` closes every weekly period that has ended and snapshots its final
ranking. It is safe to run late, twice, or concurrently, and **nothing about the live ranking
depends on it having run** — the active period is computed from the instant, so a job executing
at Monday 00:07 still closes a period that ended at Monday 00:00.

Production schedules it hourly. Running it more often is harmless.

`bun run job:weekly-recap` emails each subscriber how the week that just ended went for the
creator they follow. Run it after the rollover; running it twice sends nobody a second copy.

`bun run job:payment-reconcile` recovers payments whose webhook never arrived. It asks the
provider about everything still unsettled and routes the answer through the same transition
service the webhook uses, so a repeat is a no-op and a recovered payment gets the same ticker
line, history correction and refund a delivered one would. Production schedules it every few
minutes.

## Creator claiming

A creator proves control of a profile with a code in their bio, exactly as the removal flow
works. Verification hands over a management token — shown once, stored only as a hash — which the
web app keeps in an httpOnly cookie and never puts in a URL. `/gerenciar` is that session's page:
bio and category editing, the delivery numbers, the notification preference and the embed
snippet.

## Email provider

Without `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS` the API uses the console provider, which
delivers nothing and logs a redacted line, so the whole notification loop works locally and in
CI with no external account. A production process with neither refuses to start rather than
silently dropping notifications somebody opted into. See
`docs/decisions/0013-email-provider.md`, which also records what is *not* done yet: bounce
handling and sender authentication.

## Payment provider

Without `MERCADO_PAGO_ACCESS_TOKEN` and `MERCADO_PAGO_WEBHOOK_SECRET` the API uses the fake PIX
provider, so the whole boost flow works locally and in CI with no external account. Setting both
selects the real provider. A production process with neither refuses to start rather than take
money through a provider that settles nothing.

Before launch, one real R$5 charge has to be confirmed end to end against a live account. See
`docs/decisions/0012-pix-provider-selection.md` — it is recorded as an open item, not an
assumption.

## Documentation

| Document | What it answers |
| --- | --- |
| [`docs/product.md`](docs/product.md) | What the product is, and the business rules it may never break |
| [`docs/domain-model.md`](docs/domain-model.md) | The ubiquitous language, the bounded contexts, the aggregates and their invariants |
| [`docs/architecture.md`](docs/architecture.md) | How it is built, and why each decision went the way it did |
| [`docs/operations.md`](docs/operations.md) | Running it: processes, backups, the runbook |
| [`docs/security-and-privacy.md`](docs/security-and-privacy.md) | What it defends against, and what it knows about people |
| [`docs/decisions/`](docs/decisions/) | One file per decision, in order |

## Phase boundaries

Recorded as open items rather than assumed done:

- One real R$5 PIX charge verified end to end against a live account
  (`docs/decisions/0012-pix-provider-selection.md`)
- Bounce handling and sender authentication for email
  (`docs/decisions/0013-email-provider.md`)
- The `TODO(legal)` markers on `/regras`: refund policy, contact address and company details
