/**
 * Email is personal data.
 *
 * It is stored for receipts and notifications, never published, and never
 * written to a log in full. Everything in this file exists to keep those two
 * rules mechanical rather than remembered.
 */

const MAX_EMAIL_LENGTH = 254;
/** Deliberately permissive: delivery is the real validator, not a regex. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export class InvalidEmailError extends Error {
  override readonly name = "InvalidEmailError";
}

/**
 * The canonical form of an address.
 *
 * Subscriptions are unique per (email, creator, type), so two spellings of one
 * inbox must not become two subscriptions and therefore two copies of every
 * notification.
 */
export function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > MAX_EMAIL_LENGTH) {
    throw new InvalidEmailError("Endereco de email invalido");
  }
  if (!EMAIL_PATTERN.test(normalized)) {
    throw new InvalidEmailError("Endereco de email invalido");
  }
  return normalized;
}

export function isEmail(value: string): boolean {
  try {
    normalizeEmail(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * What may appear in a log line.
 *
 * Enough to correlate two lines about the same delivery, never enough to
 * identify the person. Anything that is not an address collapses to `***`
 * rather than being echoed, because the safest thing to print about a value
 * whose shape is unknown is nothing.
 */
export function redactEmail(value: string): string {
  const at = value.lastIndexOf("@");
  if (at <= 0 || !isEmail(value)) {
    return "***";
  }
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const initial = local.length > 1 ? (local[0] ?? "") : "";
  return `${initial}***@${domain}`;
}
