# 0006 — Proof-of-ownership challenges live in their own table

**Status:** accepted

## Context

Removal has to be provable, not merely requested: an unauthenticated visitor must
never be able to hide a creator by asking. The flow issues a code, the requester
places it on the profile, and only then is the removal honoured. Creator claiming
uses the same mechanism later.

The product data model has no table for that code, and none of the existing tables
is a reasonable home: it is neither moderation state nor an audit entry.

## Decision

Add `creator_verifications` with a `purpose` enum (`OPTOUT`, `CLAIM`), the code, a
status, an expiry and an optional contact address.

Two database constraints carry the rules:

- `code` is globally unique.
- A **partial** unique index on `(creator_id, purpose) WHERE status = 'PENDING'`
  allows at most one open challenge per creator and purpose, so repeated requests
  cannot issue a thousand codes for one profile. Repeating the request returns
  the existing challenge, which also makes the endpoint safe to retry.

Codes are drawn from a CSPRNG over an alphabet with no `0/O` or `1/I/L`, because
people retype them from a phone screen.

## Consequences

Phase 7 adds claiming by inserting rows with `purpose = 'CLAIM'` and reusing the
same verification logic; no schema change is needed for it.

Verification is a text match on profile text the requester supplies. Creator
Outdoor does not scrape platforms, bypass their protections, or drive an
unsupported browser, so the person completing the removal is the one who provides
the evidence.
