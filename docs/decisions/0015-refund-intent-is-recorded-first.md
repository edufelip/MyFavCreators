# ADR 0015 — A refund records its intent before it sends it

## Status

Accepted.

## Context

Two paths send money back: the automatic one, when a boost is voided because its
creator stopped being publicly eligible while the PIX was in flight, and the
operator-initiated one added with the administration payments screen.

Both call a provider over the network and then write what happened. Between
those two steps is a window in which the money has moved and the record does not
say so, and everything in that window is a payment that is `CONFIRMED`, whose
boost is still scoring, for money the platform no longer holds.

The automatic path is safe by accident of ordering. Its marker — the boost being
`VOID` — was committed long before the provider was ever called, so the sweep
that looks for owed refunds can always find it.

The operator path had no such marker. It wrote an audit entry in its failure
branch, which covered the failures it saw and nothing else: a `refundPayment`
that succeeded and an `applyPaymentEvent` that then threw — a failover, a pool
timeout, a lock wait behind a webhook — left the money gone and no record
anywhere that anything had been attempted. Nothing would ever look at that
payment again.

## Decision

**The intent is written before the instruction goes out.**

An operator-ordered refund writes `payment.refund_attempted` to the audit log,
committed, and only then calls the provider. The reconciliation sweep matches a
`CONFIRMED` payment with no `refunded_at` that carries that marker, regardless of
its boost's status, and settles it. It asks the provider first and then acts on
the answer: a refund the provider already made is recorded, and one it never
made is *sent*. The instruction was given; a marker whose refund never left is a
job half done, not a false alarm. Asking first is what keeps the already-refunded
case from being refunded twice.

This makes the two paths the same shape. Both commit something durable before
touching a provider, and both let the sweep finish the job. The rule generalises:
**a durable marker before a network call that moves money, never after it.**

Asking the provider before acting is what keeps this idempotent. It is not what
makes the marker cheap: a marker whose refund never left costs the refund, on the
next sweep, because that is what was ordered. What it costs is bounded and
correct — never a second refund, and never a payment that stays `CONFIRMED` for
money the platform no longer holds.

## Consequences

A refund cannot be called back. The marker is what makes the money findable, so
an operator who orders one and then changes their mind, or realises they picked
the wrong payment, cannot stop the sweep from completing it.

The alternative — a marker somebody can withdraw — is a marker that can be
withdrawn by mistake, and that failure leaves money gone with nothing pointing at
it. Between "a refund is irreversible once ordered" and "money can be lost with
no trace", the first is the one to live with, and it is written into the runbook
so nobody meets it as a surprise.

The 502 an operator sees distinguishes the two failures, because they call for
different actions. "Nada foi alterado" means the provider was never reached and
retrying is safe. "O estorno foi enviado, mas o provedor não confirmou" means the
instruction went out and the answer was lost — check the provider's own panel
before retrying. Reporting the second as the first would invite a double refund;
reporting it as success would close a ticket on money that may still be here.

The marker is an audit row rather than a column on the payment. That keeps the
payment table describing the payment, and it means the sweep's extra predicate is
a subquery — indexed by `(target_type, target_id)`, and cheap at the volumes an
hourly job sees. If the payment audit history ever grows enough for that scan to
matter, the answer is a partial index on the action, not a column.
