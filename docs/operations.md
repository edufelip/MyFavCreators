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
| Payment reconciliation | `bun run job:payment-reconcile` | Payments whose webhook was lost stay pending. Customers who really paid keep seeing a spinner. This is the one whose absence is silently visible to a paying customer. |
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
   while the payment was in flight. A refund was flagged and issued; check
   `audit_logs` for `boost.voided_ineligible_creator`.

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
request carries the same id. Ask for the id, then grep for it.

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
