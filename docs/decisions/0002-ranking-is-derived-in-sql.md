# 0002 — Ranking is derived in SQL, never stored

**Status:** accepted

## Context

Money is the only ranking signal. Boosts can be refunded long after they were confirmed, even
after the weekly period that contained them has closed, and the tie-break timestamp
(`reachedCurrentScoreAt`) has to fall back to the correct earlier value when that happens —
never to the refund time.

A denormalized `scoreCents` column would need a correcting write for every refund, every
moderation change and every late reconciliation, and any missed path would leave a public money
ranking quietly wrong.

## Decision

No ranking state is stored. One set-based SQL statement derives the ranking on read:

```sql
boost.status = 'ACTIVE' AND payment.status = 'CONFIRMED'   -- the only money that counts
SUM(amount_cents)                                          -- the score
MAX(confirmed_at)                                          -- reachedCurrentScoreAt
ORDER BY amount DESC, reached_current_score_at ASC, creator.created_at ASC
```

The weekly window is applied to `payment.confirmed_at`, and the active window is computed from
the instant rather than read from a period row, so the current week never depends on a job
having run.

PostgreSQL performs the aggregation, ordering and pagination. Boosts are never loaded into
application memory to compute a ranking.

## Consequences

A refund is a status change and nothing else: the row leaves the aggregate, and score, tie-break
timestamp and rank all correct themselves. The same query serves the weekly ranking, the general
ranking and any category ranking.

Ranking cost grows with confirmed boosts rather than being O(1). This is acceptable and will be
addressed by measurement — indexes exist on `payments (status, confirmed_at)` and
`boosts (creator_id, status)` — not by reintroducing a denormalized column.

`creator_ranking_snapshots` still exists, but for a different purpose: preserving the final
ranking of a *closed* period so the Hall da Fama can be recomputed when a historical refund
lands.
