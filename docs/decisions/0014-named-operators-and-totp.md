# ADR 0014 — Named administrators with a second factor

## Status

Accepted. Supersedes the single-password administrator described in ADR 0001's
original scope.

## Context

The administration surface can approve a profile, remove one, and send money
back. Until now it was reached with a single shared password, and every action
it authorised was written to the audit log under the actor `"admin"`.

That is two problems wearing one coat.

The first is that the audit log could not answer the question it exists to
answer. "Who removed this creator" had one possible reply, and it named an
account rather than a person. An audit trail that cannot distinguish between the
people who share an account is a log, not an audit trail — and moderation is
exactly the domain where somebody will eventually need to ask.

The second is that one leaked string was the whole authentication surface. A
shared password is shared: it lives in a password manager, gets pasted into a
chat, survives somebody leaving. There is no rotation that does not interrupt
everybody, and no revocation at all.

The obvious answer is an identity provider. It is also the wrong size: SSO for a
handful of operators is a dependency, a bill and an integration to maintain,
against a threat model where the operators are known people who already have the
deployment's environment.

## Decision

**Named operators, two factors each, carried in configuration.**

`ADMIN_OPERATORS` holds a registry — one entry per person, each with their own
scrypt password hash and their own TOTP secret — as a single base64url-encoded
JSON document. `bun run admin:operator '<name>' '<password>'` produces it,
reading any existing registry so that enrolling a name that already exists
rotates that person's credentials and carries everybody else through untouched.

The encoding is deliberate. The value lives in an environment file people
`source`, and a `$`, a `|` or a `/` in it would be mangled by the shell before
the process ever saw it — the same reason the scrypt hash uses colons and
base64url. One opaque token has no metacharacters to mangle.

TOTP rather than WebAuthn or SMS. WebAuthn is stronger and needs a credential
store, a registration ceremony and a recovery path; SMS is weaker and needs a
carrier. TOTP needs a shared secret and a clock, both of which we already have,
and every operator already owns an authenticator app.

**A code is accepted once.** Within its thirty-second window a code read over a
shoulder, or lifted from a proxy log, is otherwise still valid; the step that
matched is recorded and refused thereafter.

**Failures are budgeted per operator name, not per client address.** Every part
of a client's identity in an HTTP request is a header the client writes, so a
budget keyed on one caps nothing: an attacker rotates `x-forwarded-for` and
guesses forever. The name is what is under attack and what the attacker cannot
vary while attacking it.

**The session names its operator, inside the signature.** The cookie carries the
identifier, apps/admin sends it to the API as `x-admin-actor` on every call, and
the API refuses a call that carries the shared secret but names nobody. There is
no shared account left to file an action under.

**Membership is checked on every request, not only at sign-in.** The token is
stateless and lives eight hours, so verifying the signature alone would let
somebody removed from the registry keep full authority until their cookie
expired — which would make the documented way of taking authority away not do
that.

## Consequences

Somebody who knows an operator's name can spend that operator's login budget and
keep them out for ten minutes. This is accepted: other operators are unaffected,
so the platform never loses every administrator at once, and ten minutes is
cheaper than a guessing budget an attacker can sidestep with a header.

There is no account recovery. An operator who loses their second factor is
re-enrolled by somebody with access to the environment, which makes the
environment the recovery mechanism. At this size that is the honest shape; it
stops being so the moment operators outnumber the people who can deploy.

There is no per-operator authorisation. Every enrolled operator can do
everything, refunds included. Recorded here rather than assumed: the audit log
now says who, and the next question somebody asks will be who may.

Both the attempt counter and the spent-code set are process-local. One admin
process is the deployment today; a second would double the login budget and allow
one replay of a code per process, and would need a shared store first.
