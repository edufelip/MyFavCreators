# Creator Outdoor — product

## What the product is

A digital billboard shaped like a live leaderboard. People pay to give visibility to creator
profiles; the creators receiving the highest total value of confirmed boosts rank highest and
receive the most prominent positions on the platform.

It is a public transparent money-ranked leaderboard, a self-service creator advertising
platform, a creator discovery destination and a competitive live scoreboard. It should read
in about five seconds and should never feel like a social network, an enterprise dashboard, a
creator CRM, a crowdfunding platform or a complex ad manager.

## What the product is not

These are business rules, not preferences.

**No creator payouts.** No money is transferred to creators. There are no creator balances,
withdrawals, payouts, payment splits, marketplace escrow, revenue sharing, creator financial
accounts or creator KYC for receiving money. 100% of boost revenue belongs to the platform,
minus payment processing fees, taxes, refunds and normal operating expenses. Creator payout
infrastructure must never be built without an explicit specification changing this model.

**Not donations or tipping.** Creator Outdoor is not crowdfunding, donations, tipping,
fundraising or financial support for creators, and nothing may imply that money paid by a
customer reaches the promoted creator.

**Not fake engagement.** The platform does not sell, reward or guarantee followers,
subscribers, likes, comments, saves, watch time, external shares or external views. External
engagement never affects rankings.

**Not gambling.** Boosting never enters anyone into a lottery or raffle, and never awards
randomized prizes, chance-based cashback, redeemable coins or points.

## Customers

**Creators promoting themselves.** Explicitly allowed. They buy prominence, rank,
impressions, outbound clicks, CTR, shareability and campaign momentum.

**Fandoms and torcidas.** Fans boost creators they like, to move them upward, to take or
defend #1, and to be recognised as supporters.

## What a boost buys

A confirmed boost purchases visibility on Creator Outdoor and delivers:

1. **Ranking contribution** — the amount is added to the creator's weekly and all-time score.
2. **Rotation entitlement** — the creator becomes eligible for the *Impulsionados agora*
   rotation pool for 24 hours after confirmation. This means participation in the eligible
   pool for the configured period. It does **not** mean the creator stays continuously visible.
3. **Supporter wall entry** — an optional display name and short message; anonymous boosts
   display *Anônimo*.
4. **A shareable result** carrying the creator's actual rank movement.
5. **Measured visibility** — eligible impressions and outbound clicks generated while the
   creator appears across Creator Outdoor.

## Advertising promise

The platform guarantees product mechanics, never audience behaviour. It never promises a
final rank, a number of impressions or clicks, followers, external engagement or external
views. Delivery is described as *visibilidade mensurável com exibições e cliques acompanhados
pela plataforma*, and a particular boost is never credited with a particular click unless the
system can actually establish that attribution.

## Ranking

Money is the only ranking signal. There is no secret algorithm.

For a weekly period, a creator's score is the sum of `boost.amountCents` where the boost is
`ACTIVE`, its payment is `CONFIRMED`, and `payment.confirmedAt` falls inside the period. The
all-time ranking is the same sum without a window.

Order is:

1. score, descending
2. `reachedCurrentScoreAt`, ascending — whoever reached that score first
3. `creator.createdAt`, ascending

`reachedCurrentScoreAt` is derived from the most recent confirmation among the boosts
*currently* contributing. R$50 at 10:00 plus R$50 at 11:00 is R$100 reached at 11:00; if the
11:00 boost is refunded the score falls back to R$50 reached at 10:00 — the refund time is
never treated as the time the lower score was reached.

Never affecting a ranking: pending, failed, expired, cancelled or refunded payments; reversed
boosts; impressions, clicks, CTR, followers, subscribers, likes, comments, views, saves,
external shares, engagement or AI scores.

### Weekly period

Monday 00:00:00 to the following Monday 00:00:00, in `America/Sao_Paulo`, persisted as UTC.
The active period is determined mathematically from the instant, never from when a job ran:
a rollover executing at Monday 00:07 still closes a period that ended at Monday 00:00.

### Take #1

For a creator who is not #1:

```
amountRequired = leaderAmountCents - creatorAmountCents + MIN_INCREMENT_CENTS
amountRequired = max(amountRequired, MIN_BOOST_CENTS)
```

With the defaults (`MIN_INCREMENT_CENTS=100`, `MIN_BOOST_CENTS=500`), a R$487 leader and a
R$393 creator quote **R$95**. The quote is hidden for the current leader.

The quote reserves nothing. The leaderboard may move while a PIX is pending; the customer is
charged exactly the amount they saw, never a second amount, and the success screen shows the
position actually reached — which may be #3 even though the quote was calculated for #1.

## Money

All monetary values are integer centavos: R$5,00 is `500`, R$99,90 is `9990`. Currency is
BRL. Money is never a float. Formatting happens only at the presentation layer.

## Copy rules

UI language is pt-BR; code, comments, documentation and commit messages are English. Every
public product string lives in `apps/web/src/lib/copy.ts`.

Forbidden public wording, because it implies a payout or a donation: *apoie, apoio, apoiar,
doe, doação, vaquinha, contribuição, gorjeta, repasse, support, donate, tip, fund.* Never
claim that money, or a share of it, goes to the creator. Gambling wording is forbidden too:
*sorteio, concorra, prêmio em dinheiro, chance de ganhar.*

### Mandatory disclosure

`<BoostDisclosure />` renders, verbatim and visibly:

> Você está comprando destaque nesta plataforma. Nenhum valor é repassado ao criador.

From Phase 3 it must appear on the homepage boost form, the creator page boost area, the PIX
checkout screen and the public rules page, with E2E coverage asserting all four. It may never
be hidden, collapsed, placed behind a tooltip or reduced to unreadable fine print.

Whenever checkout originated from the *Assuma o #1* call to action, the rank quote disclosure
is also shown:

> Valor calculado com base no ranking atual. A posição pode mudar antes da confirmação do PIX.

## Creator eligibility

Only a creator with `moderationStatus = APPROVED` may appear publicly, rank, receive new
boosts, enter rotation, appear on category pages, enter the sitemap or generate a public OG
card. If a creator becomes ineligible before a pending payment confirms, the boost is not
activated: it is marked `VOID` and a refund or reconciliation follows.

## Phases

| Phase | Scope |
| --- | --- |
| 1 | Foundation: tooling, schema, seed, weekly and all-time ranking, billboard, leaderboard, countdown, Take #1 |
| 2 | Submission, URL normalization, deduplication, suppression, moderation, opt-out, reporting, audit log |
| 3 | Boost and fake PIX: payment provider interface, payment events, checkout, transactional activation |
| 4 | The complete live loop: rotation, sharing, dynamic OG, rank events, snapshots, weekly rollover |
| 5 | Real PIX provider, refunds, reconciliation |
| 6 | Torcida, analytics aggregates, notifications |
| 7 | Creator claiming, Hall da Fama, embeds, final production copy |
| 8 | Hardening: security, observability, performance, accessibility, SEO, privacy |

Phase 1 is implemented. Everything from Phase 2 onward is not, and the code deliberately
contains no placeholder implementations of it.

## Product filter

Before implementing anything, ask: does this help someone buy visibility, deliver that
visibility measurably, operate the platform safely, or understand the ranking? If not, it
probably does not belong in V1.
