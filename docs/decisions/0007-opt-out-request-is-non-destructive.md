# 0007 — A removal request changes nothing public

**Status:** accepted

## Context

Two rules in the specification pull in opposite directions.

- Moderation states: *"Only `APPROVED` is public."*
- Opt-out: *"Before verification: `OPTOUT_VERIFICATION_PENDING`. Creator remains
  visible unless admin manually removes them for safety."*

Read together literally, a removal request would move an approved creator to
`OPTOUT_VERIFICATION_PENDING`, which is not `APPROVED` and therefore not public —
contradicting "creator remains visible" in the same paragraph.

That reading is also a live griefing hole. The request endpoint is
unauthenticated by design, so anyone could knock the current #1 off the billboard
with one click, in the middle of a week that people paid money to influence.

## Decision

A removal request issues a challenge and **changes no moderation status at all**.
The creator stays `APPROVED`, visible and ranked. The request is recorded in the
audit log and nothing else.

`OPTOUT_VERIFICATION_PENDING` remains in the lifecycle for an administrator who
chooses to hold a profile during a disputed removal — the "unless admin manually
removes them for safety" half of the rule. It is never applied by the request.

Verification moves the creator straight from `APPROVED` to `OPTED_OUT`, which is
terminal, hides them everywhere immediately, and suppresses the profile against
resubmission.

## Consequences

Both statements hold: only `APPROVED` is public, and the creator remains visible
until somebody proves control of the profile.

Integration and end-to-end tests assert the property directly — after a request,
the creator is still on the leaderboard, still reachable by slug, and still merely
a duplicate rather than a suppressed identity.

The first implementation of this flow did move the creator on request, and the
end-to-end suite is what surfaced it. If a future change makes the request
destructive again, `an unverified request changes nothing public` fails.
