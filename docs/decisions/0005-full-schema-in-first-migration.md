# 0005 — The full data model ships in the first migration

**Status:** accepted

## Context

Phase 1 only reads categories, creators, creator links, boosts and payments. The product data
model also defines payment events, ranking periods, snapshots, rank events, impressions,
outbound clicks, notification subscriptions, reports, audit logs and creator suppressions,
which Phases 2 through 6 will use.

## Decision

Create the entire data model in `0000_initial_schema`, including every uniqueness constraint
and foreign key, even for tables no Phase 1 code touches.

## Consequences

The constraints that make later phases correct — payment idempotency, webhook replay
protection, snapshot uniqueness, impression and click deduplication, creator deduplication and
suppression — exist from the start and cannot be forgotten under delivery pressure while a
payment integration is being written.

Later phases add behaviour rather than rewriting the foundation, which is the point of the
phased plan. The cost is empty tables in a Phase 1 database, which is cheap.

This decision is about the *schema* only. No application code, endpoint or UI for a later phase
is implemented ahead of its phase, with one deliberate exception: the `<BoostDisclosure />`
component exists now, carrying the mandated wording verbatim, so Phase 3 only has to place it.
