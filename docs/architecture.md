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
| `POST /v1/boosts` | Create a boost and its PIX payment (rate limited) |
| `GET /v1/payments/:id/checkout` | The stored PIX payload for a payment |
| `GET /v1/payments/:id/status` | Authoritative payment state and real rank movement |
| `POST /v1/webhooks/payments/:provider` | Provider events, authenticated by the provider |
| `GET /v1/rotation` | The *Impulsionados agora* feed |
| `GET /v1/rank-events` | The overtake ticker |
| `GET /v1/champion` | The most recent weekly champion |

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

## Payments

A boost and the payment that funds it are created together, both `PENDING`. Nothing about a
ranking changes until a provider says the money settled: a customer closing the tab, or a
frontend that decides on its own that a payment worked, cannot move a centavo of anyone's score.

`PixPaymentProvider` is the only thing the rest of the code knows about a provider. Domain logic
never sees a provider SDK, so choosing a production provider is writing one adapter rather than
touching the ranking, the boost lifecycle or the payment state machine.

`FakePixPaymentProvider` settles nothing but signs its own webhooks, so the development flow
exercises the same authentication and the same idempotency as production. Its simulation routes
are mounted only outside production, and the guard lives in `createApp` rather than in the route
file, so a future refactor cannot mount them by accident.

`MercadoPagoPixProvider` is the production adapter (ADR 0012). It authenticates webhooks with the
provider's `x-signature` manifest — HMAC over `id`, `x-request-id` and the timestamp, compared in
constant time, with a five-minute freshness window so a captured delivery cannot be replayed
later or aimed at a different payment. A verified notification is still only a *hint*: the
adapter re-reads the payment from the provider's API and reports that status, so a body that
someone managed to forge past the signature check still cannot confirm a payment that did not
settle. An unrecognised provider status maps to `null` and is dropped rather than guessed at.

`resolvePaymentProvider` picks between them. Credentials present selects the real provider; their
absence selects the fake one, so a missing external credential never blocks local work or CI. A
**production** process without credentials is a misconfiguration rather than a fallback and
refuses to start: charging real money through a provider that settles nothing would be selling a
promotion no bank ever confirms.

**Reconciliation** (`bun run job:payment-reconcile`) asks the provider about every payment still
`CREATED` or `PENDING` and older than a few minutes, then feeds the answer through the same
transition service the webhook uses and the same follow-ups. Webhooks get lost — a delivery times
out, a deploy drops one — and without this a customer who really paid watches a spinner forever.
There is deliberately no second state machine and no second set of consequences: a recovered
payment produces the ticker line, the corrected history and the refund a delivered one would
have. Repeating it is a no-op for the same reason a replayed webhook is: the event fingerprint is
unique. A provider failure on one payment is counted and skipped, leaving that payment a
candidate for the next run.

Exactly-once processing, the payment state machine and the boost lifecycle are described in
ADR 0008. The short version: lock the payment row, claim the event fingerprint against a unique
index, validate the transition, then move payment and boost together in one transaction.

The PIX payload never carries the provider payment id — the payload is pasted into a banking app
and is effectively public, while the provider payment id is the server-side idempotency and
lookup key. The checkout screen reads the payload back from the API by payment id rather than
carrying it in a URL, where it would land in browser history, referrer headers and access logs.

## The live loop

**Rotation** is a deterministic hash of a time bucket and the creator id, described in
ADR 0010. SQL returns everyone entitled and deliberately does not order them; the domain
decides who is shown, so the feed cannot be bought.

**Weekly rollover** (`bun run job:weekly-rollover`) closes every period that has ended and
snapshots its ranking. Idempotent by construction: the snapshot write is an upsert keyed by
(creator, period), closing a closed period is a no-op, and the ranking recorded is derived from
the boosts that count at that moment. It looks back several weeks, so a job that did not run for
a fortnight still closes everything it missed. The live ranking never depends on it having run.

**Historical refund correction.** A refund landing after a period closed recomputes that
period's snapshots, which may remove a creator entirely and may change who the champion was —
Hall da Fama shows financially active boosts, not stale history.

**The overtake ticker** is written after the payment transaction commits, never inside it. A
failure there costs a ticker line, never a correct payment or a correct ranking.

Both the ticker and the success screen reconstruct the position a creator held *before* a boost
by subtracting that boost from their current score and re-reading the ranking. The creator
themselves is excluded from that count: their own post-boost total is always above their
pre-boost total, and counting it would place them one rung behind where they actually stood —
inventing a climb for a boost that moved nobody. This product sells prominence, so a screen that
overstates the position money bought is not a cosmetic bug.

**Live refresh** re-runs the server render on an interval (ADR 0011), pausing to a slow
heartbeat while the tab is hidden.

**Heat mode** is styling in the closing 24 hours of a week and changes no ranking behaviour.

**Share cards** are generated per creator and for the homepage. They carry only what is already
public on the page they represent — no supporter name, message, email or identifier — because a
share card is the most widely copied surface the product has.

## The Torcida

A creator page lists who bought their prominence, derived from the same boosts
the ranking counts — `ACTIVE` boost, `CONFIRMED` payment, confirmation inside the
window — so a refunded boost leaves the wall for exactly the reason it leaves the
score. Nothing is stored twice.

Rows group by supporter **and** by whether the boost was anonymous. Grouping on
the supporter alone would fold an anonymous boost into a named row and publish,
under a name, an amount its payer asked not to have attributed to them. One
person who chose anonymity for part of their boosts therefore occupies two rows
while still counting as one supporter, which is why `supporterCount` is computed
separately rather than read off the rows.

Wall ids are hashed per creator: stable on one profile, useless on another, so a
supporter cannot be followed across the site by comparing them.

## Delivery measurement

Impressions and outbound clicks record what the platform showed. **No ranking
query reads any of it**, and nothing here can move a position — money is the only
ranking signal, and mixing traffic into it would turn attention into rank.

Both are deduplicated by (creator, surface, session, hour) and (link, session,
hour) respectively, enforced by unique indexes, so a retried beacon or a page
restored from the back/forward cache cannot inflate a number.

The analytics session is an httpOnly cookie the page cannot read, added to the
beacon by the web server. A client able to name its own session could mint
impressions for any creator by inventing new ones. It is deliberately separate
from the supporter key: mixing them would let analytics deduplication reshape who
counts as a supporter.

CTR is `null` rather than zero when nothing was shown. Zero clicks out of zero
impressions is not a rate of zero; it is a rate nobody can state, and a delivery
report printing "0%" there would be claiming a measurement it never made.

`/out/{creatorLinkId}` resolves through the API, which returns the stored URL for
a known link id — the destination never comes from the request, which is what
stops it being an open redirect, and a link whose creator stopped being public
stops resolving immediately. It is a page rather than a route handler so a dead
link lands on the site's own not-found page instead of a bare status code the
browser renders as a network error; that also means following a link never
creates a tracking cookie for somebody who does not already have one, and their
click simply goes uncounted.

## Notifications

`EmailProvider` is the only thing the rest of the code knows about a mail
service (ADR 0013), the same shape as `PixPaymentProvider`.
`ConsoleEmailProvider` delivers nothing, so the whole loop — subscribe, claim,
render, send, unsubscribe — is exercised without an external account. A
production process without credentials refuses to start rather than silently
dropping every notification somebody opted into.

**Subscribing** happens when a boost confirms and the payer left an address.
Addresses are normalized, so two spellings of one inbox are one subscription and
therefore one copy of every message. Nothing about a subscription is ever
public.

**Dethrone** is decided by `detectLeaderChange`, deliberately *not* by the
overtake ticker. The ticker describes a creator's own climb and stays silent when
somebody enters the ranking, which is right for "subiu de 5º para 2º" and wrong
here: a newcomer who buys the top spot outright has dethroned the leader just as
surely as a regular who climbed past them.

**Exactly once** is a database property, not a code path. Every delivery claims a
unique `(subscription, dedupe_key)` row *before* sending, so a redelivered
webhook, a reconciliation pass over the same payment, a retried recap job and two
racing processes all produce one email. The claim is released only when the send
itself failed, so a later run genuinely retries — a crash between claim and send
costs one email nobody receives, which is the cheaper of the two mistakes.

**Unsubscribing** is one click. Every message carries the RFC 8058 headers, so a
mail client can offer the button itself, and the link lands on a page that asks
before acting: mail clients prefetch links, and a GET that unsubscribed would
unsubscribe people who never clicked. The answer is identical for a live token,
a used one and one that never existed — anything else would turn the link into an
oracle for whether an address is subscribed.

Email never appears in a log in full. `redactEmail` is what may be printed.

## Claiming a profile

A creator proves control the same way somebody proves it to remove a profile: a
code that has to appear on the bio. Requesting one changes nothing public — an
unauthenticated visitor asking about a profile must never move it.

Verification issues a **management token**, shown exactly once and stored only as
a SHA-256 hash. A plain hash with no secret is right here and would be wrong for
a password: the token is 256 bits of uniform randomness, so there is nothing to
guess and no dictionary to run, and what the hash buys is that a leaked dump
hands nobody control of a profile. Re-verifying replaces the token, which is how
somebody who lost theirs gets back in and how the old one stops working.

The token travels as a bearer credential from the web server, held in an
httpOnly cookie, and **never in a URL**: a management link in browser history, a
referrer header or an access log would hand somebody else the profile.

What a claimed creator may change is deliberately narrow — the bio and the
category. The display name and the platform links are how a visitor tells one
profile from another, and letting a claimant rewrite them would turn a claimed
profile into a way to impersonate somebody else after the fact.

The dashboard shows the same ranking numbers the public page shows, plus the
delivery measurement and their own notification setting. There is no private
ranking and no second version of the truth: the product's claim is that money is
the only signal and the ranking is not a secret algorithm, and a dashboard
showing something the public page does not would undo that.

## Hall da Fama and the badge

Champions are read from the closed weekly snapshots, so a refund landing after a
period closed corrects the history rather than preserving a champion whose money
went back. `championWeeks` counts the same rows and powers the badge on a
profile.

The embeddable badge is an **SVG**, not an iframe or a script: it works in a
README, a link-in-bio page and an email signature, it runs no code on somebody
else's site, and it can carry no cookie. Anything a creator embeds elsewhere is a
promise about what Creator Outdoor puts on other people's pages, and the smallest
possible promise is a picture. Display names are XML-escaped before they reach
that markup.

## Public copy

Interface strings live in `apps/web/src/lib/copy.ts`, and a unit test walks every
one of them — applying sample arguments to the functions — and fails on any
wording that implies a payout, a donation or a game of chance.

The long-form prose on `/regras` is the deliberate exception: it lives in the
page. It is the one surface whose job is to *name* those ideas and deny them
("não é vaquinha, não é doação"), so a bank scan would either fail on it or need
an exemption that hollows out the check. Instead a Playwright audit reads the
rendered pages and applies the rule where it actually matters — to what a
visitor sees — with the rules page held to the opposite standard: it must
contain each denial, and every sentence putting money and a creator together
must carry one.

That audit also skips what a supporter or a creator wrote. Their words are
theirs; the rule is about what the platform says.

## Errors in logs

A database driver puts the whole statement *and its parameters* into the error
message, so logging `error.message` publishes whatever the request carried — an
email address, a supporter's name, a token. `describeError` is what may be
printed: it prefers the deepest cause (the database's own complaint rather than
the statement wrapping it), truncates, drops everything a driver appends after
`params:`, and redacts anything shaped like an address. Keeping that rule by
remembering it at every call site is not keeping it at all.

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
