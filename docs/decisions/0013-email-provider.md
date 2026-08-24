# ADR 0013 — Resend for transactional email

## Status

Accepted.

## Context

Creator Outdoor sends two notifications: "somebody took the #1 from the creator
you follow", and a weekly recap. Both go to people who gave an address at
checkout, both must carry a one-click unsubscribe, and neither may ever be sent
twice for the same happening.

That last requirement is settled in our own database, not by a provider: the
delivery is claimed against a unique key before it is sent. What a provider has
to give us is delivery, authenticated sending domains, and RFC 8058 one-click
unsubscribe headers passed through unmodified.

Candidates considered:

**Amazon SES.** The cheapest at volume and the most operationally involved: an
account starts in a sandbox that only sends to verified addresses, and leaving it
is a support request with a described sending practice. Bounce and complaint
handling is a set of SNS topics you wire yourself. For a product whose entire
mail volume is two notification types, that is a lot of infrastructure to own
before the first message.

**Postmark.** Excellent deliverability and the clearest separation between
transactional and broadcast streams. Rejected only because its free tier is a
trial rather than an ongoing allowance, which makes the local and CI story worse
than the alternatives; we would still need the console provider, but we could not
exercise a real send cheaply while developing.

**Resend.** A single HTTP endpoint, no SDK required, custom `headers` passed
through verbatim (which is what one-click unsubscribe needs), and a free tier
large enough for early volume. The whole adapter is one `fetch` call, which
matches how the PIX adapter is built and keeps the provider a swap rather than a
dependency.

## Decision

Use Resend, behind the `EmailProvider` interface.

The interface is the point. Domain logic never sees a mail SDK, the templates
are plain data, and the entire notification loop — subscribe, claim, render,
send, unsubscribe — is exercised in tests against `ConsoleEmailProvider`, which
delivers nothing. Replacing Resend later means writing one adapter.

`RESEND_API_KEY` and `EMAIL_FROM_ADDRESS` select it. Without both, the console
provider is used, so local work and CI need no external account. A production
process without them refuses to start rather than silently dropping every
notification somebody opted into — the same rule as the PIX provider.

## Consequences

Every message carries `List-Unsubscribe` and `List-Unsubscribe-Post`, so a mail
client can offer the button itself. This is both the decent thing to do and the
practical one: a reader who cannot find the unsubscribe reports the mail as spam
instead, and a domain collecting those reports stops reaching anybody.

Bounce and complaint webhooks are **not** consumed yet. Nothing in the product
depends on them today, and a half-wired bounce handler is worse than none.
Recorded here as an open item: before any meaningful volume, a hard bounce must
disable the subscription that produced it, exactly as an unsubscribe does.

Sender authentication (SPF, DKIM and a DMARC policy on the sending domain) is a
deployment task, not a code one. It is not done, and mail from an unauthenticated
domain will not reliably arrive. Recorded here rather than assumed.
