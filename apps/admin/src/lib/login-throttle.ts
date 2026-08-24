/**
 * Login attempt throttling.
 *
 * A single administrator password is the whole authentication surface, so brute
 * force is the obvious attack. Attempts are counted per client and the window
 * resets only on success, which makes guessing expensive without ever locking
 * the operator out permanently.
 */
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;

type Attempt = { count: number; resetAt: number };

const attempts = new Map<string, Attempt>();

export function isThrottled(key: string, now = Date.now()): boolean {
  const attempt = attempts.get(key);
  if (attempt === undefined || attempt.resetAt <= now) {
    return false;
  }
  return attempt.count >= MAX_ATTEMPTS;
}

export function recordFailedAttempt(key: string, now = Date.now()): void {
  const attempt = attempts.get(key);
  if (attempt === undefined || attempt.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  attempt.count += 1;
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
}
