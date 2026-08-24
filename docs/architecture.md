# Creator Outdoor — architecture

## Shape

A Bun workspace monorepo orchestrated with Turborepo. Three applications and five packages.

```
apps/web  ──HTTP──┐
                  ├──> apps/api ──> packages/domain    (pure rules)
apps/admin ─HTTP──┘              ├─> packages/contracts (API DTOs)
                                 ├─> packages/config    (typed env)
                                 └─> packages/db ──> PostgreSQL 18
```

## Dependency direction

Enforced, not aspirational:

- `apps/web` and `apps/admin` reach business data **only over HTTP**. Neither declares
  `drizzle-orm` or `@creator-outdoor/db`, and a unit test asserts that
  (`apps/api/test/unit/architecture.test.ts`).
- `packages/domain` imports nothing but relative paths — no React, Next.js, Elysia, Drizzle,
  PostgreSQL, payment SDK, email SDK or hosting API. A test walks every source file and fails
  on any non-relative import (`packages/domain/test/architecture.test.ts`).
- Ranking never touches analytics. Impressions, outbound clicks, CTR and external engagement
  are structurally absent from `packages/db/src/repositories/rankings.ts`,
  `apps/api/src/services/rankings.ts` and `apps/api/src/serializers/rankings.ts`; a test greps
  those files for analytics identifiers.
- `packages/testkit` is only ever a `devDependency`.

## Applications

### `apps/api` — the authority

Elysia on Bun. Owns business rules, transactions and every write. Versioned under `/v1`.

Public surface:

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness |
| `GET /v1/rankings/weekly` | Weekly ranking (`limit`, `offset`, `category`) |
| `GET /v1/rankings/all-time` | General ranking, same parameters |
| `GET /v1/creators/:slug` | Public creator page; 404 for anything not `APPROVED` |
| `POST /v1/creators/submissions` | Creator submission (rate limited) |
| `POST /v1/creators/:slug/reports` | Report a creator (rate limited) |
| `POST /v1/creators/:slug/opt-out` | Open a removal challenge (rate limited) |
| `POST /v1/creators/:slug/opt-out/verify` | Complete a removal with proof (rate limited) |

Internal surface, reached only server-to-server from apps/admin and authorized by
`ADMIN_API_SECRET` on every route before any handler work:

| Route | Purpose |
| --- | --- |
| `GET /internal/admin/creators` | Moderation queue by status |
| `GET /internal/admin/creators/:id` | One creator, with moderation metadata |
| `POST /internal/admin/creators/:id/{approve,reject,remove,restore}` | Moderation decisions |
| `PATCH /internal/admin/creators/:id` | Metadata completion |
| `GET /internal/admin/reports`, `POST /internal/admin/reports/:id/resolve` | Reports |
| `GET /internal/admin/audit-logs` | Audit trail |

Every path and query parameter is validated at the boundary; frontend types are never treated
as runtime validation. CORS uses an explicit allowlist built from `WEB_ORIGIN` and
`ADMIN_ORIGIN` — never `*` — and CORS is treated as a browser-read restriction, not as
authorization. Errors return a fixed body shape and never leak a driver message, a stack trace
or an internal identifier.

Admin endpoints will live under `/internal/admin/*` from Phase 2 and are never exposed to
public clients.

### `apps/web` — the billboard

Next.js 16.3, App Router, Tailwind CSS 4, mobile-first. Server Components render the ranking
so it is indexable; the homepage is `force-dynamic` because the leaderboard is live. The only
client component in Phase 1 is the countdown, which receives its initial label from the server
so the first client paint matches the server HTML exactly.

Responses from the API are validated against the published contract before any field reaches a
component (`parseContract`), and an unreachable API renders an explicit unavailable state
rather than a 500.

### `apps/admin` — administration

Next.js 16.3. A placeholder in Phase 1 that already states the boundary Phase 2 must preserve:
the browser talks only to the admin Next.js server, the administrator session lives in a secure
HttpOnly cookie there, and every mutation is a server-to-server call into the API's internal
admin surface authenticated with `ADMIN_API_SECRET`. That secret never reaches the browser.

## Packages

### `packages/domain`

Pure functions, the primary mutation-testing target later. Money (`MoneyCents`), weekly
periods, ranking order, `deriveCurrentScoreReachedAt`, `calculateRankMovement`,
`calculateTakeFirstPlace`, `calculateRotationWindow`, and the enums every other layer projects
(boost status, payment status, moderation status, claim status, creator platform).

Configuration is always passed in — the package never reads `process.env`, so a test can rank
a leaderboard in any timezone with any minimum boost.

### `packages/contracts`

TypeBox schemas (Elysia's own type system) plus the static types they infer. Public DTOs are
explicit and are never database models. Enum unions are written out as literals so `Static<>`
infers exact unions rather than widening to `string`; `packages/contracts/test/enums.test.ts`
proves each union still matches the domain enum it mirrors.

### `packages/db`

The only package that knows SQL. Drizzle schema, committed migrations, repositories,
transaction helper and the seed. Untyped driver rows pass through validators in
`packages/db/src/row.ts` before reaching typed code, so a schema drift surfaces as a clear
error instead of an implicit `any` travelling into a public response.

### `packages/config`

Zod parses the environment exactly once per runtime, at import. An invalid environment fails
the process at startup rather than at the first request. Entry points are separated so that
importing product constants never triggers a server-only parse: `@creator-outdoor/config`
(constants and schemas), `/api`, `/web`, `/admin`.

## Ranking implementation

Ranking is **derived**, never stored. There is no denormalized score column to correct, so a
refund simply removes a row from the aggregate and the score, the tie-break timestamp and the
rank all fall back on their own.

One set-based SQL statement does the work (`getLeaderboardPage`):

1. `contribution` — join `boosts` to `payments`, keep `boost.status = 'ACTIVE'` and
   `payment.status = 'CONFIRMED'`, apply the period window to `payment.confirmed_at`.
2. `score` — `SUM(amount_cents)`, `MAX(confirmed_at)` as `reached_current_score_at`, and
   `COUNT(DISTINCT supporter_key)` as the supporter count.
3. `ranked` — join `creators` restricted to `moderation_status = 'APPROVED'`, join the primary
   link, and `ROW_NUMBER() OVER (ORDER BY amount DESC, reached_current_score_at ASC,
   creator.created_at ASC, creator.id ASC)`.

Because PostgreSQL evaluates `WHERE` before window functions, filtering by category ranks
*within* that category. `COUNT(*) OVER ()` returns the total in the same pass, and the final
selection returns the requested page plus rank 1, so the billboard is correct on every page.

Boosts are never pulled into application memory to compute a ranking.

**Supporter count** is `COUNT(DISTINCT COALESCE(fan_identity_key, 'boost:' || boost.id))`:
distinct fan identities, with each boost that carries no identity counting once. Supporters are
never grouped by display name, so two different people called "Marina" stay two supporters.

## Submitted URLs are a security boundary

`normalizeCreatorUrl` runs before deduplication and before anything is stored. It is the only
place a submitted URL is trusted, and it refuses:

- any scheme that is not http(s), including `data:` and `javascript:`
- embedded credentials
- loopback, private, carrier-grade NAT, link-local (including `169.254.169.254`), reserved and
  multicast addresses, in every IPv4 shorthand and numeric encoding, plus IPv6 unique-local,
  link-local and IPv4-mapped forms
- bare intranet hostnames and `.local`, `.internal`, `.lan`, `.home.arpa` suffixes
- platform URLs that name no creator (a video, a playlist, a search, a reserved path)

Paths are split first and percent-decoded per segment, so an encoded separator stays inside a
segment and fails handle validation instead of becoming a path boundary. `twitter.com` folds
to `x.com`, hosts lowercase, `www.` and query strings and fragments are dropped, and the result
is idempotent — normalizing a canonical URL returns it unchanged.

The output `normalizedKey` (`instagram:handle`, `youtube:@handle`, `spotify:artist-id`,
`site:domain`) is unique in the database, so two spellings of one profile can never become two
creators competing for the same fandom's money.

## Rate limiting

An in-process fixed-window limiter guards submissions, reports, opt-out requests and
verifications, with per-scope limits taken from configuration so a deployment tunes them and
the code never disables them. Public writes travel browser → apps/web → apps/api, so apps/web
forwards the visitor's address: without it the API would see one address for the whole internet
and a single enthusiastic visitor could throttle everybody. The forwarded address is a
throttling key only, never an authentication claim.

## Administrator authentication

No customer identity provider for a single operator. The password is stored as a scrypt hash
(`ADMIN_PASSWORD_HASH`), verified timing-safe, and the encoding is deliberately shell-safe —
colon separators and base64url — because the value lives in an environment file people
`source`, where a `$` would be silently expanded away. Failed attempts are throttled per client.

The session is an HMAC-signed, expiring token in an HttpOnly, `SameSite=Strict` cookie owned by
apps/admin. It carries an issue time, an expiry and a nonce, and no credential at all. Server
actions validate the request origin in addition to Next.js's own check.

## Money

Integer centavos everywhere: `integer` columns, a branded `MoneyCents` domain type whose
constructor rejects floats and negatives, and a single presentation-layer formatter. `formatBrl`
drops the centavos for whole amounts so the copy reads `R$95`, matching the copy bank.

## Privacy

Public responses are built by explicit allowlist serializers; database rows are never
serialized directly. `supporterEmail`, `supporterKey`, `fanIdentityKey`, analytics `sid`,
`providerPaymentId`, payment `rawMetadata`, payment event payloads, moderation metadata and
suppression records are never public. Serialization tests assert the absence of each field name
and value, at the serializer level and again over HTTP.

## Transactions

Database transactions wrap anything where consistency affects money, payment state, boost
activation, refunds, moderation eligibility or snapshots. Analytics is deliberately outside
that boundary and may be eventually consistent.

## Database constraints as the idempotency mechanism

Application-level checks are not sufficient, so uniqueness lives in PostgreSQL:

| Constraint | What it prevents |
| --- | --- |
| `payments (provider, provider_payment_id)` | Two rows for the same provider payment |
| `payment_events (event_fingerprint)` | A replayed webhook being processed twice |
| `boosts (payment_id)` | One payment activating two boosts |
| `creator_links (normalized_key)` | Duplicate creator submissions racing past a check |
| `creator_suppressions (normalized_key)` | Resubmission of a verified opt-out |
| `creator_ranking_snapshots (creator_id, ranking_period_id)` | A repeated rollover duplicating snapshots |
| `impressions (creator_id, surface, session_id, hour_bucket)` | Impression double counting |
| `outbound_clicks (creator_link_id, session_id, hour_bucket)` | Click double counting |
| `ranking_periods (type, starts_at, ends_at)` | Two rows for the same window |

## Testing

| Layer | Runner | Notes |
| --- | --- | --- |
| Domain | `bun test` | Pure, no I/O |
| Contracts | `bun test` | Schema/domain parity |
| API unit | `bun test` | Serializer allowlists, architecture assertions |
| API integration | `bun test` | Real PostgreSQL, migrations applied, truncated per test |
| Web / admin | `bun test` + happy-dom + React Testing Library | Components |
| E2E | Playwright on Node 24 | Real browser against the built stack |

PostgreSQL is never mocked for repository or integration tests. happy-dom must register its
globals before Testing Library is imported, which is why `test/setup.ts` registers first and
then dynamically imports `cleanup`.

## Decisions

See [`decisions/`](decisions/). Anything that later contradicts this document should arrive as
a new ADR rather than as a silent change.

## Assumptions recorded during Phase 1

- **Bun version.** `packageManager` and `.bun-version` pin `bun@1.3.14` as specified. The
  container this repository was bootstrapped in only had Bun 1.3.11 available (its network
  policy blocks `bun.sh`), so `bun.lock` was generated with 1.3.11. The lockfile format is
  shared and CI installs with the pinned 1.3.14.
- **Local PostgreSQL during bootstrap.** Docker was unavailable in the bootstrap container, so
  migrations, the seed and the integration suite were verified against a PostgreSQL 16 server
  started from system binaries. Nothing in the schema uses a PostgreSQL 17- or 18-only feature
  — UUID keys use `gen_random_uuid()`, available since PostgreSQL 13 — so the schema stays
  portable. `docker-compose.yml` and CI both use PostgreSQL 18.6.
- **Full schema in the first migration.** Every table from the product data model is created
  now, including tables no Phase 1 code reads. See ADR 0005.
- **Report status values.** The data model specifies a `status` column for reports without
  enumerating it; `OPEN` and `RESOLVED` are used, paired with the specified `resolvedAt`.
- **Seeded creators are fictional.** Seeding a real public figure would place a real profile on
  a public money ranking without their knowledge, so all fifteen are invented personas. Their
  amounts reproduce the documented Take #1 example: R$487 leader, R$393 challenger, R$95 quote.
- **Seed provider name.** Seeded payments use the provider `seed`, which cannot collide with
  the fake or real PIX providers introduced in Phases 3 and 5.
- **Avatars.** Fictional creators have no avatar, so `avatarUrl` is null and the UI renders
  initials. This also exercises the null path that real creators without metadata will hit.
- **Amount labels.** The copy bank supplies "R$X impulsionados esta semana" for the weekly
  ranking. The general ranking needs the equivalent phrasing for a total, so
  "R$X impulsionados no total" was derived; both live in the copy bank.
- **Disabled calls to action.** Boost buttons render disabled with an "Em breve" state until
  Phase 3 rather than linking nowhere. `VER PERFIL` and the `Regras` navigation item are
  omitted entirely until the creator page and the rules page exist, so the Phase 1 homepage
  contains no dead links.
- **Preinstalled browsers.** `playwright.config.ts` honours an optional
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE` for environments that already ship a Chromium build
  (containers, air-gapped runners); it is declared in `turbo.json` because Turborepo runs tasks
  in strict environment mode. CI installs the browser Playwright pins instead and needs no
  override.
- **Graphify.** The published `graphify` npm package is a random-graph generator, not the
  AST knowledge-graph tool the specification refers to, so no dependency was invented. When the
  correct CLI is available, add a root `graphify` script that writes to `graphify-out/`, which
  is already in `.gitignore`.
- **CodeRabbit and DeepSource.** No configuration was fabricated. Both integrate through their
  own dashboards; missing credentials must never block local development or CI.
- **Opt-out semantics.** The specification says only `APPROVED` is public *and* that a creator
  remains visible before verification. ADR 0007 resolves the contradiction: the request changes
  no status at all, which also closes a griefing hole.
- **Report statuses and reasons.** The data model specifies a `status` column for reports
  without enumerating it, and no reason list; `OPEN`/`RESOLVED` and a six-value reason set are
  used, both covered by contract parity tests.
- **Creator metadata.** The default provider derives everything from the URL and performs no
  network call, because the product forbids brittle scrapers and ToS-violating extraction. An
  administrator completes the rest during moderation, which is the documented fallback.
- **TypeScript 7.** `tsc` runs the TypeScript 7 compiler with the full strict flag set,
  including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. No `any`, `as any`,
  double cast, `@ts-ignore` or type-silencing assertion appears anywhere in the repository.
