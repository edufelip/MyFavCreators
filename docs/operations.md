# Creator Outdoor — running it

Deployment shape, the things that have to be true before launch, and what to do
when something breaks. Written to be read at 3am.

## Processes

| Process | Command | What happens if it stops |
| --- | --- | --- |
| API | `bun run apps/api/src/index.ts` | Everything stops: the web app reads through it. |
| Web | `next start` in `apps/web` | The public site is down. Payments already in flight still settle: webhooks reach the API directly. |
| Admin | `next start` in `apps/admin` | Moderation stops. Nothing public is affected. |
| Weekly rollover | `bun run job:weekly-rollover` | Nothing immediate. **The live ranking never depends on it** — it computes the period from the instant. Hall da Fama stops gaining weeks until it runs, and a late run closes everything it missed. |
| Payment reconciliation | `bun run job:payment-reconcile` | Two things stop happening: payments whose webhook was lost stay pending, so customers who really paid keep seeing a spinner; and refunds the platform owes but failed to make are never retried, so it keeps money for promotions it never delivered. The one whose absence costs a customer directly. |
| Weekly recap | `bun run job:weekly-recap` | Nobody gets the weekly email. No other effect. |

Suggested schedule: rollover hourly, reconciliation every five minutes, recap
once a week after the rollover. Every job is safe to run late, twice, or
concurrently.

## Environment

Every variable is parsed at startup by `packages/config`, so a misconfigured
process fails immediately rather than at the first request. `.env.example` is
the complete list.

Two credentials decide which adapters a process uses:

- `MERCADO_PAGO_ACCESS_TOKEN` + `MERCADO_PAGO_WEBHOOK_SECRET` → the real PIX
  provider. Without both, the fake provider, which settles nothing.
- `RESEND_API_KEY` + `EMAIL_FROM_ADDRESS` → real email. Without both, the
  console provider, which delivers nothing.

**A production process refuses to start without either pair.** Taking money
through a provider that settles nothing, or silently dropping notifications
somebody opted into, are worse failures than not starting.

`SENTRY_DSN` is the third and is deliberately *not* in that rule. Without it,
failures are in the log and nowhere else — a real loss, but a smaller one than
refusing to boot. An unreadable DSN makes the tracker inert and says so
(`sentry_dsn_unreadable`) rather than sending reports somewhere unintended.

## Database

PostgreSQL 18. Migrations are plain SQL under `packages/db/migrations`, applied
with `bun run db:migrate`, tracked in a journal so they run once and in order.

### Backups

Not automated by this repository — it holds no infrastructure. What the
deployment has to provide, and what to check before launch:

1. **Point-in-time recovery**, not only nightly dumps. The rows that matter most
   (`payments`, `payment_events`, `boosts`) are written continuously, and losing
   an hour of them means losing money somebody paid.
2. **A restore that has actually been run.** A backup nobody has restored is a
   hypothesis. Restore into a scratch database and check that
   `select count(*) from payment_events` is non-zero and that the weekly
   leaderboard query returns the same order it did in production.
3. **Retention long enough for a dispute.** A chargeback can arrive months after
   the payment; the `payment_events` row is the evidence of what the provider
   said and when.

### What is safe to lose

`impressions` and `outbound_clicks` are measurement, not money. They can be
truncated to reclaim space without affecting a single ranking, because no
ranking query reads them. Everything else is either money, moderation, or
somebody's consent to be contacted.

## Runbook

### A customer paid and their boost is not active

1. Find the payment: `select id, status, updated_at from payments where provider_payment_id = $1`.
2. If it is `PENDING`, the webhook was lost. Run `bun run job:payment-reconcile`.
   It asks the provider and applies the answer through the same transition
   service the webhook uses, so this is safe and repeatable.
3. If it is `CONFIRMED` but the boost is `VOID`, the creator became ineligible
   while the payment was in flight, so the boost was refused and a refund is
   owed. Check `audit_logs` for `boost.voided_ineligible_creator`.

   A refund is *attempted* at that moment; it can fail. `bun run
   job:payment-reconcile` finds every payment still in that shape — CONFIRMED,
   boost VOID, no refund recorded — asks the provider, and refunds or records
   what the provider already did. Run it, then re-check `refunded_at`.

   An operator can also issue one directly, from `/pagamentos` in the admin app
   or with `POST /internal/admin/payments/:id/refund` and a body of
   `{"reason": "..."}`. Both go through the same transition service, so the
   ranking and the closed-period history correct themselves, and both record the
   operator's own name and their reason as `payment.refunded_by_operator`. A
   repeated instruction is recognised as the same one and does not send the money
   twice.

### A refund came back 502

Two different answers, and the difference matters.

"Nada foi alterado" means the provider could not be reached at all — nothing was
sent, and retrying is safe. The audit log carries `payment.refund_not_attempted`.

"O estorno foi enviado, mas o provedor não confirmou" means the instruction went
out and the answer was lost. Whether the money moved is genuinely unknown from
here, so **check the provider's own panel before retrying**. The audit log
carries `payment.refund_uncertain`, and `bun run job:payment-reconcile` picks the
payment up on its next run: it asks the provider, refunds if the money is still
here, and records one that already happened. Doing nothing settles it either
way; a support conversation usually cannot wait for the next run.

**A refund cannot be called back.** That marker is what makes the money
findable, and the sweep acts on it — so an operator who orders a refund and then
changes their mind, or realises they picked the wrong payment, cannot stop it:
the next run completes it. Read the payment before pressing the button. The
alternative would be a marker somebody can withdraw, which is a marker that can
be withdrawn by mistake and leave money gone with nothing pointing at it.

### An operator lost their second factor, or somebody joined or left

`bun run admin:operator '<name>' '<password>'` prints a new `ADMIN_OPERATORS`
value. Pass the current one in the environment first so the others are carried
through:

```sh
ADMIN_OPERATORS="$ADMIN_OPERATORS" bun run admin:operator 'ana.silva' '<password>'
```

Enrolling a name that already exists replaces that person's password and TOTP
secret and leaves everybody else alone — that is how both a rotation and a lost
phone are handled. Removing somebody means editing the registry: decode it,
drop the entry, re-encode. There is no account recovery by design; the
environment is the recovery mechanism.

**Removing an operator ends their session at the next request**, not eight hours
later when their cookie expires. Every request checks the name in the cookie
against the current registry, so dropping the entry and restarting is enough —
there is no separate revocation step and no session to hunt down.

A locked-out operator is not a bug. Five failures against one name close that
name for ten minutes, and the window is per name, so nobody else is affected.

### The ranking looks wrong

The ranking is derived, so there is nothing to repair — only inputs to check.
`select status, count(*) from boosts group by status` and the same for
`payments`. A creator missing from the leaderboard is a creator whose boosts are
not `ACTIVE`, whose payments are not `CONFIRMED`, or who is not `APPROVED`.

### A creator says their profile should not be here

Point them at the removal flow on their own profile page: it needs a code on the
bio, which is what stops anyone else from removing them. An administrator can
also set `REMOVED` in the admin app; a verified opt-out additionally suppresses
the profile against resubmission.

### Emails are not arriving

1. Check the process actually has credentials — without them it is the console
   provider, and every send is a log line rather than an email.
2. Check `notification_deliveries`: a row means the send was claimed. If a row
   exists and no email arrived, the failure is at the provider.
3. Sender authentication (SPF, DKIM, DMARC) is a deployment task and is **not
   done**. Mail from an unauthenticated domain does not reliably arrive.

### Something is throwing and the logs are unhelpful

Every response carries `x-request-id`, and every log line produced by that
request carries the same id. Ask for the id, then grep for it. If `SENTRY_DSN`
is set, the same id is a tag on the report, so a report and its log lines find
each other.

Only a 500 is reported. A 400 and a 404 are answers, not faults, and reporting
them would bury the ones that matter.

### A scheduled job did not do anything

Jobs run through `runJob`, so a failed one logs `job_failed`, reports it, and
exits non-zero. Check the scheduler's exit code first — a job that "ran fine"
with a non-zero exit is a job that failed.

A job that exits zero but did nothing is a different problem: read the
`job_finished` line, which carries the run's own counts.

## Performance

Measured on a laptop-class machine against a seeded database, then again with
50,000 confirmed boosts across 147 approved creators — roughly a year of
moderate traffic.

| Endpoint | 834 boosts | 50,000 boosts |
| --- | --- | --- |
| Weekly leaderboard | 3 ms | 17 ms |
| All-time leaderboard (100) | 8 ms | 101 ms |
| Creator page (API) | 6 ms | 114 ms |
| Torcida (all time) | 5 ms | 15 ms |
| Rotation | 4 ms | 15 ms |
| Delivery report | 5 ms | 5 ms |
| Homepage (rendered HTML) | 41 ms | 36 ms |

**The weekly surfaces stay fast because they are windowed**: the period filter
uses `payments (status, confirmed_at)` and touches only that week's rows. The
homepage is unaffected by dataset size for the same reason.

**The all-time aggregates scale linearly**, because they genuinely read every
confirmed boost — a hash join and a hash aggregate, which is the right plan for
"sum everything". At 50,000 boosts that is about 50 ms of database time; at a
million it will be about a second.

No index fixes that: an aggregate over every row is a sequential scan by
definition, and adding indexes would slow every write for no measured gain. The
fix, when it is needed, is a maintained aggregate — a materialized view of
all-time scores refreshed on the same schedule as the rollover. **Not built,
because it is not needed yet**, and building it now would mean a second
definition of the ranking to keep in step.

The threshold to watch: the all-time leaderboard and the creator page. When
either passes ~300 ms in production, that is the signal.

## Before launch

Not done, and not to be assumed done:

- [ ] One real R$5 PIX charge, confirmed end to end against a live account
      (`docs/decisions/0012-pix-provider-selection.md`).
- [ ] Sender authentication for the email domain; bounce handling
      (`docs/decisions/0013-email-provider.md`).
- [ ] A restore rehearsed from a real backup.
- [ ] The `TODO(legal)` items on `/regras`: refund policy, contact address,
      company details.
- [ ] Rate limits reviewed against real traffic; the defaults in
      `packages/config/src/product.ts` are estimates, not measurements.
- [ ] A shared rate-limit store if more than one API instance runs: the buckets
      are per process, so two instances allow twice the configured rate.
