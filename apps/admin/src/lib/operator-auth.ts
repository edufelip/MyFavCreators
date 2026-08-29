import {
  type AdminOperator,
  findOperator,
  hashPassword,
  isOperatorId,
  usesPublishedExampleCredentials,
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
  | { readonly kind: "INVALID" }
  /**
   * The credentials published in this repository, offered to a production
   * deployment. Named rather than folded into `INVALID` because it is the one
   * failure whose cause the person in front of the screen needs to know: they
   * are holding a password anybody can read, and the fix is to enrol a real
   * operator, not to try a different code.
   */
  | { readonly kind: "PUBLISHED_CREDENTIALS" };

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

/** One shared budget for every name that could not be an operator. */
const INVALID_NAME_BUCKET = "\u0000invalid";

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

/**
 * Where the example credentials are refused, and why it is here.
 *
 * `.env.example` ships a working operator so the admin app runs the moment
 * somebody clones this repository — which means its password and TOTP seed are
 * public. In production that is an account anybody on the internet can use to
 * approve creators and issue refunds.
 *
 * The refusal was first written into `parseAdminConfig`, and that was wrong
 * twice over. `next build` sets `NODE_ENV=production` too, so building the
 * admin app locally failed on a check about deployments — the same conflation
 * of "built for production" with "running in production" that the cookie
 * `Secure` flag hit from the other side. And refusing at parse time is
 * all-or-nothing: a deployment that enrolled a real operator but left the
 * example entry behind lost its whole admin app over an account that grants
 * nothing once this check exists.
 *
 * Here it costs a build nothing — a build signs nobody in — and it refuses
 * exactly the credential that is public.
 */
export type AuthenticateOptions = {
  /** True only when this process is actually serving production traffic. */
  readonly isProduction: boolean;
  readonly now?: number;
};

export function authenticateOperator(
  operators: readonly AdminOperator[],
  attempt: LoginAttempt,
  options: AuthenticateOptions,
): LoginOutcome {
  const now = options.now ?? Date.now();
  /*
   * A name that could never be an operator is still budgeted, otherwise the
   * shape of a valid name is free to probe for. They all share one bucket: none
   * of them can ever authenticate, so there is nothing to tell apart, and a key
   * built from attacker-supplied text is a map an unauthenticated caller can
   * grow without limit.
   */
  const key = isOperatorId(attempt.operator) ? attempt.operator : INVALID_NAME_BUCKET;

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

  /*
   * Checked after the credentials, not before. Answering "those are the example
   * credentials" to somebody who did not present them tells an unauthenticated
   * caller which accounts exist and which are unusable — the reconnaissance the
   * single INVALID message exists to withhold. Whoever sees this message has
   * already proved they hold the password and the TOTP seed, which is to say
   * they have already read the file it came from.
   */
  if (options.isProduction && usesPublishedExampleCredentials(operator)) {
    recordFailure(key, now);
    return { kind: "PUBLISHED_CREDENTIALS" };
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

/** When the map was last swept, so a flood does not pay a scan per request. */
let lastSweep = 0;

function recordFailure(key: string, now: number): void {
  /*
   * Expired buckets are dropped here rather than never, so a long-running
   * process does not keep a row for every name anybody has ever guessed — but
   * at most once a window, because a full scan on every failed attempt is work
   * an attacker chooses the amount of. `RateLimiter` in the API solves the same
   * problem the same way.
   */
  if (now - lastSweep >= WINDOW_MS) {
    lastSweep = now;
    for (const [existing, attempt] of attempts) {
      if (attempt.resetAt <= now) {
        attempts.delete(existing);
      }
    }
  }

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
  lastSweep = 0;
}
