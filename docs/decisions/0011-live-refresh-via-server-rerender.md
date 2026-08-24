# 0011 — Live refresh re-runs the server render

**Status:** accepted

## Context

The homepage is one server-rendered page: billboard, boost form, rotation feed,
leaderboard and overtake ticker, all from the API. It has to stay indexable, so
the initial render must be server-side HTML — and it has to feel live, because
watching a number move is most of the product.

The specification allows TanStack Query for interactive refresh and explicitly
warns against forcing all data fetching through it.

## Decision

A small client component calls `router.refresh()` on an interval. Next re-runs the
server render and streams the updated tree.

Polling is 15 seconds while the tab is visible and 2 minutes while it is hidden,
with an immediate refresh when the visitor comes back. Near-real-time is enough
here; no socket or event stream is introduced.

TanStack Query is not added. Fetching the leaderboard on the client would mean a
second copy of the rendering — one server component and one client component
producing the same cards — for a page whose first paint must be server HTML
anyway.

## Consequences

One rendering path, and one round trip refreshes every live surface at once:
billboard, rotation, ranking and ticker cannot drift out of step with each other.

The checkout screen is different and does poll a JSON endpoint directly, because
it waits on a single value and needs a faster cadence. It goes through a
same-origin route in apps/web rather than calling the API cross-origin, which
keeps the API's CORS allowlist as narrow as it is.

If a future surface genuinely needs client-side caching, mutation state or
optimistic updates, TanStack Query is the right tool and this ADR is superseded
for that surface — not for this one.
