# 0008 — Exactly-once payment processing

**Status:** accepted

## Context

A payment provider will deliver the same webhook more than once — on retry, on
timeout, on its own replay tooling — and sometimes out of order. Each delivery, if
processed, activates a boost, moves a public money ranking, and later sends a
notification. Processing one twice would double a creator's score with money that
was paid once.

Application-level checks are not enough: two concurrent deliveries both read
`PENDING`, both decide to activate, and both write.

## Decision

Every provider event goes through one function, `applyPaymentEvent`, inside a
single transaction:

1. **Lock the payment row** with `SELECT ... FOR UPDATE`. Concurrent deliveries
   for the same payment serialise, so the second reads what the first committed.
2. **Claim the event fingerprint** by inserting into `payment_events`, whose
   `event_fingerprint` is unique. Losing that claim means the event was already
   processed; the correct answer is to acknowledge and stop. The database decides
   this, not a read-then-write check.
3. **Validate the transition** against the payment state machine. An illegal move
   (a stale `PENDING` after `CONFIRMED`, a `CONFIRMED` after `FAILED`) is
   recorded — it is a fact about what the provider sent — and changes nothing.
4. **Move the payment and the boost together**, stamping the rotation window on
   confirmation.

The fingerprint is `sha256(provider ∥ providerPaymentId ∥ providerEventId ∥
status)`, joined on a separator that cannot occur in any part. A provider that
reuses event ids across payments, or omits them entirely, still yields a stable
and distinct fingerprint.

Reconciliation calls the same function with a synthesized event, so there is
exactly one payment state machine rather than one for webhooks and another for
polling.

## Consequences

The ranking needs no update step. It is derived from ACTIVE boosts with CONFIRMED
payments, so committing this transaction *is* the ranking change — there is no
window in which a payment is confirmed but a score is stale, and no denormalized
column a failed second write could leave wrong.

A duplicate answers 200. The provider has nothing to retry, and re-delivery would
only produce the same no-op.

Integration tests deliver the same event six times concurrently and assert that
exactly one reports `APPLIED` and the score moves once.
