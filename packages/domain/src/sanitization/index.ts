/**
 * What may be written to a log about a failure or printed in an error report.
 *
 * A database driver puts the whole statement *and its parameters* into the
 * error message, so logging `error.message` publishes whatever the request
 * carried — an email address, a supporter's name, a token. The rule is that
 * email never reaches a log in full; keeping that rule by remembering it at
 * every call site is not keeping it at all, so it is mechanical here.
 */

const MAX_LENGTH = 200;
/**
 * How much of a message is looked at.
 *
 * `MAX_LENGTH` plus enough slack that a redaction beginning inside the printed
 * region is never cut in half by this — the longest match `REDACTIONS` can
 * produce is around 570 characters, so 1024 of slack is generous.
 */
const SCAN_LIMIT = MAX_LENGTH + 1024;
/** Everything a driver appends from here on is parameter data. */
const PARAMETER_MARKERS = ["params:", "parameters:"];

/**
 * Shapes that must never survive into a log line or an error report.
 *
 * An error message is written by whoever threw, which includes libraries and
 * providers, so what ends up in one is not something the call sites can be
 * trusted to have thought about. These are the things that have actually turned
 * up in one: an address, a credential a client sent, a cookie header quoted
 * back, and the PIX payload — the string somebody pastes into their bank, which
 * is the single field a support screenshot must never carry.
 */
const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}/g, "[email]"],
  [/\b(bearer|basic)\s{1,8}[\w.~+/=-]{1,512}/gi, "$1 [redacted]"],
  /*
   * Any assignment whose name ends in a credential word. The earlier pattern
   * could not match `MERCADO_PAGO_ACCESS_TOKEN=` at all — `_` is a word
   * character, so there is no `\b` before `TOKEN` — and a provider SDK quoting
   * its own configuration back is exactly how one of these reaches a message.
   */
  [
    /[\w-]{0,64}(?:token|secret|password|key|credential|session)"?\s{0,8}[:=]\s{0,8}"?[\w.~+/=-]{1,512}"?/gi,
    "[redacted]",
  ],
  /*
   * A PIX "copia e cola", in two shapes, and both are needed.
   *
   * The first matches a complete BR Code, from its EMV payload-format
   * indicator to its CRC. Anchoring on the terminator is what lets it span
   * spaces: a real code carries the merchant name and city in fields 59 and
   * 60 — "CREATOR OUTDOOR PAGAMENTO", "SAO PAULO" — so a character class
   * without a space stopped at the first one and printed everything after it,
   * including the full txid. Only `fake-pix` produces the space-free payload
   * the tests happened to use.
   *
   * The second catches a payload with no CRC on it, which is the shape a log
   * line usually holds: a fragment, cut off by whatever quoted it. Dropping
   * this one for the terminator form stopped redacting exactly the case the
   * original pattern was written for.
   */
  [/\b000201[\s\S]{16,600}?6304[0-9A-Fa-f]{4}/g, "[pix-payload]"],
  [/\b000201[\w.*$%:;,+/=-]{16,512}/g, "[pix-payload]"],
  [/\b(sk|pk|rk)_(live|test)_[\w-]{1,128}/gi, "[key]"],
];

export type DescribedError = {
  readonly name: string;
  readonly message: string;
  /**
   * The stack, with its first line removed.
   *
   * That first line is `Name: message`, which is the half that can carry a
   * driver's parameters or somebody's address; the frames below it are file
   * paths, line numbers and function names, which carry nothing about the
   * request. Keeping the frames is what makes a report worth reading.
   */
  readonly frames: readonly string[];
};

/** Enough to locate the fault, few enough that a report stays small. */
const MAX_FRAMES = 30;

/**
 * Reduces an error to a name and a message safe to print.
 *
 * Prefers the deepest cause, because a wrapper like Drizzle's query error
 * carries the statement while its cause carries the actual database complaint —
 * `relation "x" does not exist` is the useful half and the harmless one.
 */
export function describeError(error: unknown): DescribedError {
  if (!(error instanceof Error)) {
    return { name: "Unknown", message: "unknown", frames: [] };
  }
  try {
    const deepest = deepestCause(error);
    return {
      name: sanitize(deepest.name),
      message: sanitize(deepest.message),
      frames: safeFrames(deepest.stack),
    };
  } catch {
    return { name: "Unreadable", message: "unreadable", frames: [] };
  }
}

function safeFrames(stack: string | undefined): readonly string[] {
  if (stack === undefined) {
    return [];
  }
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .slice(0, MAX_FRAMES)
    .map(sanitize);
}

function deepestCause(error: Error): Error {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    const cause = current.cause;
    if (!(cause instanceof Error)) {
      break;
    }
    current = cause;
  }
  return current;
}

/**
 * Reduces any text to something safe to print in logs or error reports.
 */
export function sanitize(message: string): string {
  let cleaned = message.length > SCAN_LIMIT ? message.slice(0, SCAN_LIMIT) : message;
  for (const marker of PARAMETER_MARKERS) {
    const at = cleaned.toLowerCase().indexOf(marker);
    if (at >= 0) {
      cleaned = cleaned.slice(0, at);
    }
  }
  for (const [pattern, replacement] of REDACTIONS) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned.length > MAX_LENGTH ? `${cleaned.slice(0, MAX_LENGTH)}...` : cleaned;
}
