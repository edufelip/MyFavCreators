# Creator Outdoor — security and privacy

What the product defends against, what it deliberately does not, and what it
knows about people. Written as a review rather than a policy: every claim here
points at the code or the test that makes it true.

## Trust boundaries

```
browser ──▶ apps/web (server) ──▶ apps/api ──▶ PostgreSQL
                                     ▲
provider (PIX, email) ───────────────┘
```

**apps/web and apps/admin never touch the database.** Everything goes through
the API, which validates its own input and serializes through an explicit
allowlist. An architecture test enforces the missing dependency, so this cannot
erode by accident.

Nothing the browser sends is trusted as identity:

| Value | Where it comes from | Why the browser cannot choose it |
| --- | --- | --- |
| Supporter identity | HMAC of an email or a browser key, derived server-side | Otherwise anybody could merge or split supporters on a public wall |
| Analytics session | httpOnly cookie set by the web server | A page that could name its own session could mint impressions for any creator |
| Management token | bearer credential held in an httpOnly cookie | It is the whole authority to edit a profile |
| Admin session | sealed httpOnly cookie | A readable session is a stolen session |
| Rank, price, amount | computed server-side from the database | Frontend state must never decide what somebody is charged or where they rank |

## Payments

Exactly-once processing is a database property, not a code path (ADR 0008):
lock the payment row, claim a unique event fingerprint, validate the transition,
move payment and boost together. A replayed webhook loses the claim and changes
nothing.

**Webhook authentication.** The real provider's `x-signature` manifest is
verified with a constant-time comparison and a five-minute freshness window, so
a captured delivery cannot be replayed later or aimed at a different payment. A
verified notification is still only a hint: the adapter re-reads the payment
from the provider's API rather than trusting the body, so a forged body that
somehow passed the signature check still cannot confirm a payment that did not
settle.

**Replay review.** Three independent defences, in order: the signature stops a
forged request, the timestamp window stops a captured one, and the fingerprint
stops a genuine one delivered twice. Losing any one of them still leaves a
correct payment.

**The PIX payload never carries the provider payment id.** The payload is pasted
into a banking app and is effectively public; the provider payment id is the
server-side lookup key for webhooks.

## Submitted URLs

A creator URL is attacker-supplied and becomes an outbound link. `isUnsafeHost`
refuses loopback, private ranges, link-local (including the cloud metadata
address `169.254.169.254`), carrier-grade NAT, benchmarking, multicast and bare
internal hostnames — including the shorthand, hexadecimal and octal encodings
used to smuggle them past string checks.

A numeric host that `isUnsafeHost` cannot pin down is refused rather than
allowed, including anything zero-padded — `010.0.0.1` is octal 8 to one parser
and decimal 10 to another, and a check that has to guess which reader comes next
is not a check.

**This is defence in depth, not a patched hole.** In the submission path the
host reaching `isUnsafeHost` has already been through `new URL()`, which resolves
the ambiguity the way browsers and most clients do, and the *resolved* URL is
what gets stored — `http://012.0.0.1/` becomes `10.0.0.1` and is refused as
private, `http://0177.0.0.1/` becomes `127.0.0.1` and is refused as loopback.
The rule exists for any future caller that passes a raw host, where nothing has
resolved it yet.

What mutation testing did surface was a genuine parser bug next to it:
`parseIpv4` read `0178` as decimal 178. A leading zero means octal, 8 is not an
octal digit, and the address is invalid — not a number in a different base.

Percent-decoding happens **per path segment, after splitting**, so `%2F` cannot
become a path separator and turn one profile's URL into another's.

## Rate limits

Per client address, per scope, in memory:

| Scope | Default | Why |
| --- | --- | --- |
| Creator submission | 5/hour | A submission costs human moderation time |
| Report | 10/hour | Same |
| Opt-out request | 5/hour | Issues a code; a flood would mint codes for one profile |
| Opt-out / claim verification | 20/hour | Guessing a code is the attack this bounds |
| Boost creation | 20/hour | Each creates a payment at the provider |
| Analytics ingestion | 240/minute | A page reports a batch per view |

**Known limits of this design**, recorded rather than glossed:

- In-memory buckets are **per process**. Two API instances allow twice the
  configured rate. Adequate for one instance; a shared store is the fix when
  there is more than one.
- The key is the forwarded client address, which is a throttling key and never
  an authentication claim. Behind a proxy that does not set `x-forwarded-for`,
  everybody shares one bucket.
- The defaults are estimates, not measurements. Review them against real
  traffic before launch.

## Administration

Per-person accounts with two factors: a scrypt password hash checked in constant
time, and a TOTP code that is accepted once. The admin app holds a server-only
shared secret for its calls to the API, and that secret never reaches a browser —
an E2E test asserts it does not appear in any page.

Every moderation decision and every refund is written to `audit_logs` with the
operator's own name, the action, the target and metadata, in the same
transaction as the decision itself. The name comes from the signed session
cookie, and the API refuses an administrative call that does not carry one, so
there is no path that records an action nobody signed for.

Failed sign-ins are budgeted per operator name rather than per client address,
because a client-supplied address is not a budget an attacker has to respect.

**Not done:** there is no account recovery. An operator who loses their second
factor is re-enrolled by somebody with access to the environment, which is the
right shape at this size but means the environment is the recovery mechanism.
There is also no per-operator authorisation — every enrolled operator can do
everything, refunds included.

## What the product knows about people

| Data | Why it exists | Where it can appear |
| --- | --- | --- |
| Supporter name and message | The payer chose to show them | The public Torcida, if not anonymous |
| Supporter email | Receipts, and only the notifications they ticked | Nowhere public. Never a log line in full |
| Fan identity key | Grouping one supporter's boosts | Nowhere public, ever |
| Analytics session id | Deduplicating impressions and clicks | Nowhere public; not readable by any script |
| Claim contact email | Reaching a claimed creator | Nowhere public |
| Client address | Rate limiting | Not stored |

**Consent is per notification and per purchase.** Leaving an address subscribes
nobody to anything: the boxes on the boost form are separate questions, the
answers are recorded on the boost that carried them, and an absent answer counts
as a no. A subscription is revived only by fresh explicit consent, never by an
address reappearing — otherwise the one-click unsubscribe every message carries
would quietly undo itself on the next purchase.

**Anonymity is honoured per boost, not per person.** An anonymous boost is never
folded into the same person's named row on the wall: doing so would publish,
under a name, an amount its payer asked not to have attributed to them.

**Wall ids are hashed per creator**, so a supporter cannot be followed from one
profile to another by comparing them.

**Email never reaches a log in full.** `redactEmail` decides what may be
printed, and `describeError` strips the parameters a database driver appends to
its error messages — which is how an address reached a log once, before it was
caught.

**Deletion.** A verified opt-out hides a creator everywhere public and suppresses
resubmission; it does not delete payment records, because those are the evidence
behind money that changed hands. A subject-access or deletion process for
supporters is **not built** — recorded here as an open item rather than implied.

## Dependencies

`bun audit` reports two moderate advisories, both in **development-only**
transitive dependencies, and both in tools that never run in a deployed process:

| Advisory | Reaches production? | Why |
| --- | --- | --- |
| `qs` DoS, via `@stryker-mutator/core` | No | Mutation testing runs in CI and on a laptop |
| `esbuild` dev-server request forgery, via `drizzle-kit` | No | Migration generation runs on a laptop; the esbuild dev server is never started |

Neither has a fixed version reachable without changing the tool's own pin, and
neither is worth pinning around: the fix would be churn against a risk that does
not exist in this shape.

**What does reach production** is a deliberately short list — Elysia and its
CORS plugin, Drizzle ORM, Next.js, React, `server-only` and `uqr`. The domain
package has no runtime dependencies at all. Every provider integration is a
`fetch` call written here rather than an SDK, which is why there is no payment
or email SDK on this list.

Re-run `bun audit` before each deploy. An advisory in the production list is a
different conversation from these two.

## What this product deliberately does not defend against

- **A determined creator gaming their own ranking by paying.** That is the
  product: money buys position, transparently, and the amount is public.
- **Someone seeing who supports a creator.** The wall is public by design; the
  anonymous option is the control offered.
- **Bot traffic inflating impressions.** Deduplication bounds it per session and
  hour, and impressions buy nothing — no ranking query reads them.
