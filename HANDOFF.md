# Handoff — Creator Outdoor

Written for whoever picks this up next. Everything below was verified by running
it, not read off a plan.

## Where things stand

Branch `claude/creator-outdoor-bootstrap-yt4lyg`, at `6118296`, pushed. Working
tree clean, local HEAD identical to origin. There is no PR — do not open one
unless asked.

The product is built end to end. All eight phases of the original specification
are done: submission and moderation, the boost flow with fake and real PIX,
refunds and reconciliation, Torcida, analytics, notifications, claiming, and
the hardening pass. What has occupied recent work is not building features but
hunting a specific class of bug (below).

**Last full gate, all green:**

| Check | Result |
|---|---|
| `bunx biome check .` | 359 files, clean |
| `bun run typecheck` | 8 packages |
| `bun run test:unit` | **715 pass, 0 fail** |
| `bun run test:integration` | **280 pass, 0 fail** |
| `bun run test:e2e` | **96 pass, 0 fail** (11 spec files) |
| `bun run build` | web + admin |

Do not trust these numbers after you change anything. Re-run the gate.

## Environment, and the parts that will waste your time

```sh
cd /home/user/MyFavCreators
set -a && . ./.env && set +a      # .env is at the REPO ROOT, not in apps/*
```

- **Postgres runs on `127.0.0.1:55432`, not 5432.** It has stopped twice in this
  container. `pg_isready -h 127.0.0.1 -p 55432` to check; to restart:
  ```sh
  su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main \
    -o '-c config_file=/etc/postgresql/16/main/postgresql.conf -p 55432' \
    -l /var/log/postgresql/postgresql-16-main.log start"
  ```
  Write the log to `/var/log/postgresql/`; the `postgres` user cannot write to
  the scratchpad. Loopback auth is `trust`. Both databases have survived every
  restart so far, but check with `psql "$DATABASE_URL" -c 'select 1'`.
- **`bun run db:seed` now also runs the weekly rollover.** The seed invents six
  weeks of history and leaves the periods open, so without the rollover the Hall
  da Fama is empty and three E2E tests fail. The root script composes both; the
  inner `--filter @creator-outdoor/db db:seed` does not.
- **Playwright takes ~2 minutes when healthy.** If it takes 15, something is
  failing and timing out — most likely admin sign-in, which cascades into every
  spec behind `signInToAdmin`. Run it in the background; a foreground run gets
  moved to background at 600s and the output is truncated to the tail, which
  reads like a "did not run" list and is actually the *failed* list. Read the
  head of the output file, not the tail.
- `pkill -f "next start"` matches its own shell. Use `pkill -9 -f 'next star[t]'`
  and `pkill -9 -f 'api/src/inde[x].ts'`.
- Playwright's `reuseExistingServer` will silently serve a stale build. Rebuild
  before running, and do not kill servers immediately beforehand.
- Turborepo is in strict env mode: any new env var must be added to
  `turbo.json`'s `globalEnv` or tasks will not see it.

## The working method

This is what has been producing results, and it is worth continuing:

1. Make a change, with a test that fails without it.
2. **Verify the test catches the bug** — revert the fix, watch it fail, restore.
   Several tests in this repo passed for the wrong reason before this step was
   made routine.
3. Run the full gate.
4. Commit in coherent groups, push.
5. Send the diff to two review subagents in parallel — one for specification
   compliance, one for adversarial verification ("does this do what it says, and
   does the suite actually prove it?"). Both have found real bugs I missed,
   including two of the most serious in the whole session.
6. Act on the findings, and re-verify.

**Caveat learned the hard way:** a review subagent's in-place edit corrupted
`apps/web/src/lib/forbidden-copy.ts` mid-run. Tell them to restore what they
touch, and check `git status` after they finish. Do not trust a gate run that
overlapped with a reviewer.

## The bug class being hunted

**A failure that answers as though it succeeded**, and its close relative,
**two sides of a boundary that agree only by memory.**

Everything in the catalogue below was found and fixed. It is here so you can
recognise the shape, not as a to-do list:

- The delivery beacon posted a bare array where the contract wanted `{entries}`.
  Every page view was dropped, silently, for the life of the feature.
- The analytics cookie carried `Secure` over plain HTTP, so no click could ever
  be counted. Three more cookies had the same bug — nobody could stay signed in.
- One-click unsubscribe answered HTTP 200 and unsubscribed nobody: the
  `List-Unsubscribe` header named the confirmation *page*, which has no POST
  handler, so mail clients were served its HTML and read 200 as success.
- A 401 on a notification preference was reported to the creator as "saved".
- The refund 502 said "nothing was changed" for a refund that may have moved
  money, next to a retry button.
- A category-only PATCH erased the creator's bio.
- The error tracker leaked 7 of 8 probes to a third party.
- CI could not have passed: missing rollover history, production rate limits.
- Enum parity was enforced on one of three boundaries.
- A removed operator kept authority for eight hours.

## Three lessons that cost the most time

1. **`NODE_ENV=production` does not mean "deployed to production."** For a Next
   app it means neither — `next build` *and* `next start` both set it
   themselves. This was conflated three separate times in one session: it broke
   a local build, then it refused the E2E suite's own admin sign-in (31 tests
   timing out behind the throttle). The signal is now `DEPLOY_ENV`, which no
   tool sets on your behalf. If you need "is this really production", use
   `adminConfig.isLiveDeployment`, never `isProduction`.
2. **A rewrite that looks strictly stronger can quietly drop a case.** Turning
   the logger's exact field list into stems covered every synonym and lost
   `fanIdentityKey`, which is a substring of no stem — so the supporter's
   pseudonymous identity started printing in full and every assertion still
   passed. Same shape in the copy rules: sharing the *list* while
   re-implementing the *match* meant the copy-bank test silently stopped
   detecting any Portuguese term at all.
3. **Sharing data is not sharing a rule.** Two call sites that both read
   `FORBIDDEN_TERMS` and each apply their own regex will drift. Export the
   function, not the array.

## Hard rules (from the specification — these are not negotiable)

- **No creator payouts.** No balances, withdrawals, splits, escrow, KYC. Money
  buys prominence on the platform's own billboard and never reaches a creator.
- Not donations/tipping/crowdfunding. Not fake engagement. Not gambling.
- **Forbidden in public copy:** apoie, apoio, apoiar, doe, doação, vaquinha,
  contribuição, gorjeta, repasse, support, donate, tip, fund, sorteio, concorra,
  prêmio em dinheiro, chance de ganhar. The only exemption is `/regras`, and
  only to deny. The enforced rule is now "the word may appear, but only inside a
  denial, in its own clause" — see `apps/web/src/lib/forbidden-copy.ts`.
- **Mandatory disclosure, verbatim on four surfaces:** `Você está comprando
  destaque nesta plataforma. Nenhum valor é repassado ao criador.` Note it
  contains "repassado" — which is why the plain-occurrence scan had to go.
- **TypeScript:** no explicit `any`, no implicit `any`, no `as any`, no double
  casts, no `@ts-ignore`, no type-silencing assertions.
- web and admin **never** touch the database; only the API does. No
  floating-point money. Client state is never a security boundary. Analytics is
  never mixed with ranking.
- **Never log:** PIX payloads, full email addresses, secrets, cookies, raw
  credentials.

## What is still open

Small, deliberate, and stated so nobody thinks they are oversights:

1. **No per-operator authorisation.** Every enrolled operator can do everything,
   refunds included. Documented in `docs/security-and-privacy.md` as a
   deliberate choice at this size, not an oversight.
2. **No account recovery.** An operator who loses their second factor is
   re-enrolled by somebody with environment access.

## Where to read next

- `docs/decisions/` — 15 ADRs. `0014` (named operators and TOTP) and `0015`
  (a refund records its intent before it sends it) are the most recent and the
  most load-bearing.
- `docs/domain-model.md` — seven bounded contexts, including Administration.
- `docs/operations.md` — the runbook. Read the refund section before touching
  refunds: **a refund cannot be called back**, by design, and that is written
  down so nobody meets it as a surprise.
- `docs/security-and-privacy.md` — the threat model and what is deliberately
  not done.
