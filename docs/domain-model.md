# Creator Outdoor — domain model

The product's rules, written down as the code models them. Where a rule lives in
SQL or in a database constraint rather than in TypeScript, this document says so
and says why — a rule enforced in one place and documented in another is a rule
that drifts.

## Ubiquitous language

The interface is pt-BR; code, comments and this document are English. These are
the same nouns, and the mapping is deliberately one-to-one so a conversation
about the product and a conversation about the code use the same words.

| Portuguese (interface) | English (code) | What it is |
| --- | --- | --- |
| impulso | boost | A purchase of visibility for one creator |
| impulsionar | to boost | To buy that visibility |
| impulsionador | supporter | Somebody who paid for a boost |
| torcida | Torcida / supporter wall | The public list of who boosted a creator |
| criador | creator | A promoted profile |
| perfil | profile | The creator's page on this platform |
| ranking | leaderboard / ranking | The ordered list of creators by money |
| posição | rank | A creator's place in that order |
| semana | weekly period | Monday 00:00 to Monday 00:00, `America/Sao_Paulo` |
| Assuma o #1 | take first place | The quote to pass the current leader |
| rodízio / Impulsionados agora | rotation | The pool of creators eligible for the live feed |
| destaque | prominence | What money buys — never "support", never "apoio" |
| estorno | refund | Money returned; the boost stops counting |
| exibição | impression | One measured display of a creator |
| clique | outbound click | One measured click through to a creator's own profile |
| Hall da Fama | Hall da Fama | Past weekly champions |
| reivindicar | claim | A creator proving control of their own profile |
| descadastrar | unsubscribe | Switching a notification off |

**Words the product never uses**, because each implies money reaches a creator
or a game of chance: *apoie, apoio, apoiar, doe, doação, vaquinha, contribuição,
gorjeta, repasse, support, donate, tip, fund, sorteio, concorra, prêmio em
dinheiro, chance de ganhar*. A unit test walks every string in the copy bank and
fails on any of them.

## Bounded contexts

Seven contexts, each owning a set of decisions nothing else may make.

### Catalog

**Owns** which profiles exist and which are public. A creator, its links, its
category, its moderation status, its suppression after an opt-out.

**Language:** creator, profile, link, category, moderation status, suppression.

**Key rule:** only `APPROVED` is public. `isPubliclyEligible` is the single
predicate; every read path calls it, and a creator who is not approved is
indistinguishable from one that never existed, so no endpoint can enumerate the
moderation queue.

### Payments

**Owns** whether money settled. Payment, payment event, the state machine, the
provider adapters.

**Language:** payment, provider, provider payment id, event fingerprint,
CONFIRMED, REFUNDED.

**Key rule:** nothing outside this context writes a payment status. Every change
is checked against `ALLOWED_TRANSITIONS` first.

### Ranking

**Owns** who is where. Boost, score, rank, the weekly period, the Take #1 quote.

**Language:** boost, score, rank, period, leader, overtake.

**Key rule:** money is the only signal, and rank is *derived*, never stored
(ADR 0002). A creator's score is the sum of `boost.amountCents` where the boost
is `ACTIVE`, its payment is `CONFIRMED`, and `payment.confirmedAt` falls inside
the window.

### Delivery

**Owns** what the platform showed. Impressions, outbound clicks, CTR, the
rotation pool, the embeddable badge.

**Language:** impression, surface, outbound click, session, CTR, rotation.

**Key rule:** **no ranking query reads anything this context writes.** Traffic is
not money. This is a business rule, not a layering preference: allowing it would
make attention buy position.

### Torcida

**Owns** who is publicly credited for a creator's prominence.

**Language:** supporter, entry, anonymous, fan identity.

**Key rule:** an anonymous boost is never attributed to a name, even a name the
same person used on another boost.

### Notifications

**Owns** who hears about what. Subscriptions, deliveries, unsubscribe tokens,
the email provider adapters.

**Language:** subscription, delivery, dedupe key, one-click unsubscribe.

**Key rule:** exactly once per happening per subscriber, enforced by a unique
index rather than by application logic.

### Administration

**Owns** who may act on the platform's behalf, and the record of what they did.
Operators, the administrator session, the audit log, and the two decisions no
rule can make on its own: whether a profile belongs here, and whether a payment
should be sent back.

**Language:** operator, actor, audit entry, moderation decision, refund
instruction.

**Key rule:** every action names a person. The operator identifier comes from a
signed session and is carried into the API on every call, which refuses one that
does not have it — there is no shared account to file an action under. Removing
an operator from the registry ends their authority at the next request, not when
their cookie expires.

**What it does not own:** any transition. An operator instructs; the Payments
context decides. A refund ordered here goes through the same transition service
a webhook uses, with the same fingerprint and the same state machine, so an
instruction cannot produce a state the automatic path could not.

## Context map

```
Catalog ──"only APPROVED is public"──▶ Ranking, Delivery, Torcida, Notifications
Payments ──"the money settled"──▶ Ranking (activation) ──▶ Notifications (leader change)
Ranking ──"a creator's standing"──▶ Torcida, Notifications, Delivery (badge)
Delivery ────────────────────────✗────▶ Ranking     (deliberately absent)
Administration ──"an instruction"──▶ Catalog (moderation), Payments (refund)
```

Payments is **upstream** of everything: a ranking change is a consequence of a
payment transition, never the other way round. Delivery is **downstream of
everything and upstream of nothing** — the missing arrow is the point.

Administration is upstream of Catalog and Payments but is not a peer of them: it
supplies *instructions*, never transitions. There is no rule an operator can
apply that the domain does not already own, which is why an operator refund and
a provider refund end in exactly the same place.

## Aggregates and their invariants

### Payment (with its Boost)

The consistency boundary. A payment and the boost it funds are created together
and change together, in one transaction.

**Invariants**

1. A boost never exists without its payment. Enforced by a `NOT NULL` foreign
   key plus creation in a single transaction.
2. **One payment funds exactly one boost.** Enforced by a unique index on
   `boosts.payment_id`, so activation cannot be duplicated even by wrong code.
3. A payment moves only along `ALLOWED_TRANSITIONS`. `CONFIRMED` accepts only
   `REFUNDED`; `FAILED`, `EXPIRED`, `CANCELLED` and `REFUNDED` accept nothing.
   Money that failed can never quietly become money that counts.
4. The payment's status *proposes* the boost's — `boostStatusForPayment`:
   CREATED/PENDING → PENDING, CONFIRMED → ACTIVE, FAILED/EXPIRED/CANCELLED →
   VOID, REFUNDED → REVERSED — and the boost's own machine decides whether that
   move is legal. `VOID` and `REVERSED` are terminal, so a boost voided for an
   ineligible creator stays VOID when its payment is later refunded: REVERSED
   means "the promotion was live and was undone", and that one never ran. The
   money still moves; what stays true is the promotion's own history. A refused
   move is written to the audit log as `boost.transition_refused` rather than
   passed over in silence.
5. A boost activates only for a creator who is publicly eligible **at the moment
   of confirmation**. Otherwise it is VOID and a refund is flagged.
6. An event is applied at most once. Enforced by a unique index on
   `payment_events.event_fingerprint` (ADR 0008), claimed inside the same
   transaction that moves the payment.

**Application** is a single transaction: lock the payment row, claim the
fingerprint, check the transition, move payment and boost, stamp the rotation
window. The ranking needs no update — committing *is* the ranking change.

### Creator

**Invariants**

1. Only `APPROVED` is publicly visible, rankable, boostable or embeddable.
2. Moderation moves only along `ALLOWED_TRANSITIONS`; `OPTED_OUT` is terminal.
3. A creator's normalized link key is globally unique, so two submissions cannot
   race past an application check into two profiles for one person.
4. A verified opt-out suppresses the normalized key against resubmission.
5. A claim does not change what a profile *is*: the display name and links are
   not editable, because they are what a visitor uses to tell one profile from
   another.

### Ranking period

**Invariants**

1. The active period is computed from the instant, never read from a job's
   bookkeeping. A rollover running late still closes the period that ended.
2. A closed period's snapshot is an upsert keyed by (creator, period), so
   closing twice is a no-op.
3. A refund landing after a period closed **recomputes** that period. Hall da
   Fama shows financially active boosts, not stale history.

### Notification subscription

**Invariants**

1. **Consent is per notification and per purchase.** An address is not
   agreement: it is what a receipt goes to. A subscription exists only because
   somebody ticked a box on a boost they paid for, the answer is recorded on
   that boost, and an absent answer is a no. Agreeing to hear when a profile
   loses the top spot is not agreeing to a weekly summary, so each is its own
   subscription with its own unsubscribe token.
2. Unique per (email, creator, type). Two spellings of one inbox are one
   subscription and therefore one copy of every message.
3. A delivery is unique per (subscription, dedupe key), claimed *before*
   sending. A crash between claim and send costs one email nobody receives,
   which is the cheaper of the two mistakes.
4. An unsubscribed row is re-enabled, never duplicated — and only ever on fresh
   explicit consent. Reviving one because an address reappeared would quietly
   undo an unsubscribe, which is the one thing every message promises it will
   not do.

### Creator claim

**Invariants**

1. One claim per creator: a profile has one owner, not a queue of them.
2. The management token is stored only as a SHA-256 hash. Re-verifying replaces
   it, which is how a lost token is re-issued and how the old one stops working.
3. A token authenticates nobody once the profile stops being publicly eligible.

## Domain events

Not an event bus — these are the moments the code treats as significant, each
with exactly one place that reacts to it.

| Event | Raised by | Reacted to by |
| --- | --- | --- |
| Payment confirmed | `applyPaymentEvent` | boost activation (same transaction); then `runPaymentFollowUps` |
| Boost activated | `applyPaymentEvent` | subscription capture, overtake ticker, dethrone notification |
| Leader changed | `detectLeaderChange` | dethrone notification |
| Payment refunded | `applyPaymentEvent` | closed-period recomputation |
| Creator became ineligible mid-flight | `applyPaymentEvent` | boost voided, refund issued; retried by `settleOwedRefunds` if that call fails |
| Operator ordered a refund | `refundPaymentOnRequest` | the same transition service a webhook uses; audited as `payment.refunded_by_operator` with the operator's name and their reason |
| An operator's refund is about to be sent | `refundPaymentOnRequest` | audited as `payment.refund_uncertain` **before** the provider is called, so a refund that moves money and then loses the write is still findable by `settleOwedRefunds` (ADR 0015) |
| A boost transition was refused | `applyBoostSideEffect` | audited as `boost.transition_refused`; the payment still moves, the promotion's own history does not |
| Weekly period ended | `runWeeklyRollover` | snapshots, champion, weekly recap |

Follow-ups run **after** the payment transaction commits, never inside it, and
each is attempted independently: a ticker line, a snapshot or a refund call must
never undo an activation or make a provider retry a delivery that succeeded.
Both the webhook and reconciliation call the same `runPaymentFollowUps`, so a
recovered payment has exactly the same consequences as a delivered one.

## Where each rule lives

Three homes, chosen deliberately.

**Pure TypeScript (`packages/domain`)** — rules that are decisions about
meaning: state machines, the Take #1 formula, URL normalization and host safety,
supporter identity derivation, rotation selection, weekly period arithmetic,
money arithmetic, email normalization and redaction. This package imports
nothing but relative paths and `node:` builtins; an architecture test enforces
that, so a domain rule can never depend on a framework, a database or a
provider SDK.

**SQL (`packages/db`)** — rules about *derived* data over a set of rows: the
score, the rank, `reachedCurrentScoreAt`, the Torcida grouping, delivery
aggregates. Recomputing these in TypeScript would mean loading every boost to
answer "who is #1" and would give a second definition of the ranking to keep in
step (ADR 0002).

**Database constraints** — rules that must hold even when application code is
wrong: one boost per payment, one event per fingerprint, one subscription per
(email, creator, type), one delivery per (subscription, key), one impression per
(creator, surface, session, hour), globally unique normalized link keys. These
are the invariants where a race would otherwise mean double-charging, double-
activating or double-emailing (ADR 0008).

## Things the model deliberately does not have

- **No creator balance, payout, split, escrow or financial account.** There is no
  table, column or code path for money leaving the platform to a creator, and
  none may be added without a specification that changes the business model.
- **No stored rank.** A rank is always computed from money at read time.
- **No engagement signal.** Followers, likes, views, watch time and external
  shares are absent from the schema entirely, so no future query can start
  ranking by them.
- **No randomness in what money buys.** Rotation *selection* is a deterministic
  hash, so the feed cannot be bought and cannot be a lottery.
- **No client-supplied identity anywhere it matters.** The analytics session is
  an httpOnly cookie, supporter identity is an HMAC derived server-side, and the
  management token is a bearer credential the browser never reads.
