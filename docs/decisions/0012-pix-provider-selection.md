# 0012 — Mercado Pago as the production PIX provider

**Status:** accepted

## Context

Phase 5 needs a real PIX provider. Creator Outdoor needs charge creation, a
reliable authenticated webhook, refunds, a way to poll a charge for
reconciliation, and Brazilian production support. It needs **no** split payments,
subaccounts, marketplace flows or payouts — no money is ever transferred to a
creator, so the whole class of split/escrow features is irrelevant.

Three candidates were considered against the capabilities the product actually
uses.

| | Mercado Pago | Efí | OpenPix |
| --- | --- | --- | --- |
| PIX charge creation | Payments API, `payment_method_id: "pix"`, returns QR and copy-paste | PIX API, immediate charge | Charge API |
| Webhook authentication | Signed `x-signature` with a request-scoped manifest, plus `x-request-id` | mTLS client certificate | HMAC signature header |
| Refunds | Refunds API on the payment | PIX devolution | Refund API |
| Polling for reconciliation | Payment lookup by id | Charge lookup | Charge lookup |
| Brazilian production support | Broad, long-established | Strong, PIX-focused | Strong, PIX-focused |
| Operational cost of integration | Standard bearer token | mTLS certificate management in the deploy | Standard token |

## Decision

**Mercado Pago**, for two reasons that matter more than fee differences at this
volume:

1. **Webhook authentication without certificate management.** Its signed-header
   scheme is verifiable with an HMAC and a shared secret. Efí's mTLS is arguably
   stronger, but it puts a client certificate into the Railway deployment and into
   every local and CI environment that wants to exercise the flow — real
   operational risk for a single-replica V1, and a certificate that expires
   silently takes payments down.
2. **Reconciliation shape.** A plain payment lookup by id maps directly onto the
   existing `getPaymentStatus` contract, so reconciliation reuses the one payment
   transition service rather than growing a second path.

Fees were not the deciding factor: at launch volume the difference between these
three is smaller than the cost of one payment incident.

**This decision is reversible by design.** Everything provider-specific lives
behind `PixPaymentProvider` in `apps/api/src/payments/`. Domain logic depends on
no provider SDK, so switching means writing one adapter and one ADR.

## Consequences

`MercadoPagoPixProvider` implements the same four methods the fake one does, and
the same webhook route, transition service and idempotency apply unchanged. The
integration tests for exactly-once processing are provider-agnostic and run
against the fake provider; the adapter's own tests cover signature verification,
status mapping and payload parsing.

Credentials (`MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET`) are
environment configuration. **Without them the API still boots and still runs the
whole flow on the fake provider**, because a missing external credential must
never block local development or CI.

Choosing this provider requires a production account, and the sandbox this was
built in has no credentials. The adapter is therefore written against the
documented API shape and covered by unit tests over recorded payload shapes; the
acceptance criterion of a real R$5 charge confirming end to end must be run once
against a live account before launch. That is recorded as an open item in
`docs/architecture.md` rather than quietly assumed.
