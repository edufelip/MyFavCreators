# 0010 — Rotation is a deterministic hash, not a recency list

**Status:** accepted

## Context

A confirmed boost buys participation in the *Impulsionados agora* rotation pool
for 24 hours, and at most 30 creators are visible at a time. The obvious
implementation — show the 30 most recently boosted — quietly breaks that promise:
the moment a 31st creator is boosted, everyone earlier stops appearing while
still holding an entitlement they paid for.

Ordering by amount would be worse. It would sell position twice: once through the
ranking, and again through the feed.

## Decision

The database returns everyone still entitled, deliberately unordered — no
`order by amount`, no `order by confirmed_at desc`. The domain then selects:

```
bucket = floor(now / ROTATION_BUCKET_MINUTES)
order  = sha256(bucket ∥ creatorId)
show   = first ROTATION_FEED_MAX
```

Entitlement is one row per creator regardless of how many boosts they hold: the
maximum active `rotation_ends_at` decides, so ten boosts produce one entry.

The response reports `eligibleCount` alongside the entries, so the UI can say how
many creators are in the pool rather than implying the visible slice is all of it.

## Consequences

The selection is stable within a bucket (cacheable, reproducible in a test) and
changes when the bucket advances, which is what makes the feed feel alive without
being random on every request.

It depends on nothing that could be bought: not the amount, not impressions, not
clicks, not recency. A creator who paid R$5 yesterday and one who paid R$500 a
minute ago have the same chance of appearing in any given bucket.

Fairness is asserted, not assumed. Over 400 buckets with 60 entitled creators and
30 slots, every creator appears between 170 and 222 times against an expected 200.
A unit test holds that band, and another proves the newest entitlement is not
systematically placed first.
