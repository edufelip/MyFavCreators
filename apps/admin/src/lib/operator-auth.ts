import {
  type AdminOperator,
  findOperator,
  hashPassword,
  isOperatorId,
  verifyPassword,
  verifyTotp,
} from "@creator-outdoor/config";

/**
 * Signing a named administrator in.
 *
 * Two factors, both required: a per-person password and a per-person TOTP code.
 * Neither alone is enough, because either alone is one leak away from full
 * moderation authority — approve, remove, refund.
 *
 * Deliberately pure apart from two small process-local stores, so every rule
 * below is directly testable without a browser or a server.
 */
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;

export type LoginAttempt = {
  readonly operator: string;
  readonly password: string;
  readonly code: string;
};

export type LoginOutcome =
  | { readonly kind: "OK"; readonly operator: string }
  | { readonly kind: "THROTTLED" }
  | { readonly kind: "INVALID" };

type Attempt = { count: number; resetAt: number };

/**
 * Failures counted per operator name.
 *
 * Not per client: every part of a client's identity in an HTTP request —
 * `x-forwarded-for` above all — is a header the client itself writes, so a key
 * built from one caps nothing. An attacker rotates it and guesses forever.
 * The operator name is the thing being attacked and the thing the attacker
 * cannot vary while attacking it, so that is what the budget belongs to.
 *
 * The trade-off is real and accepted: somebody who knows a name can spend that
 * operator's budget and keep them out for the rest of the window. A ten-minute
 * wait is the price of a password-guessing budget that cannot be sidestepped,
 * and other operators are unaffected — the platform never loses every
 * administrator at once.
 */
const attempts = new Map<string, Attempt>();

/**
 * Counter steps already spent, per operator.
 *
 * A TOTP code stays valid for its whole window, so a code read over a
 * shoulder — or lifted from a proxy log — is otherwise still usable seconds
 * later. Spending it at first use closes that window.
 */
const spentSteps = new Map<string, Set<number>>();

/** A hash to check against when the name is unknown, so timing tells nothing. */
const DECOY_HASH = hashPassword("decoy-for-constant-time-rejection");

export function authenticateOperator(
  operators: readonly AdminOperator[],
  attempt: LoginAttempt,
  now = Date.now(),
): LoginOutcome {
  // A name that could never be an operator is still budgeted, otherwise the
  // shape of a valid name is free to probe for.
  const key = isOperatorId(attempt.operator) ? attempt.operator : `invalid:${attempt.operator}`;

  if (isThrottled(key, now)) {
    return { kind: "THROTTLED" };
  }

  const operator = isOperatorId(attempt.operator)
    ? findOperator(operators, attempt.operator)
    : null;

  // The work happens even for an unknown name: how long the answer takes must
  // not say whether the name exists.
  const passwordMatches = verifyPassword(attempt.password, operator?.passwordHash ?? DECOY_HASH);
  const step = operator === null ? null : verifyTotp(operator.totpSecret, attempt.code, now);

  if (operator === null || !passwordMatches || step === null || isSpent(operator.id, step)) {
    recordFailure(key, now);
    return { kind: "INVALID" };
  }

  spend(operator.id, step);
  attempts.delete(key);
  return { kind: "OK", operator: operator.id };
}

function isThrottled(key: string, now: number): boolean {
  const attempt = attempts.get(key);
  if (attempt === undefined || attempt.resetAt <= now) {
    return false;
  }
  return attempt.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string, now: number): void {
  const attempt = attempts.get(key);
  if (attempt === undefined || attempt.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  attempt.count += 1;
}

function isSpent(operatorId: string, step: number): boolean {
  return spentSteps.get(operatorId)?.has(step) === true;
}

function spend(operatorId: string, step: number): void {
  const spent = spentSteps.get(operatorId) ?? new Set<number>();
  spent.add(step);
  // Only the current window and its neighbours can ever match again, so the
  // set stays small without a sweep.
  for (const previous of spent) {
    if (previous < step - 2) {
      spent.delete(previous);
    }
  }
  spentSteps.set(operatorId, spent);
}

/** Clears the process-local state. For tests only. */
export function resetOperatorAuthState(): void {
  attempts.clear();
  spentSteps.clear();
}
