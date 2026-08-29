/**
 * What may be written to a log about a failure.
 *
 * A database driver puts the whole statement *and its parameters* into the
 * error message, so logging `error.message` publishes whatever the request
 * carried — an email address, a supporter's name, a token. The rule is that
 * email never reaches a log in full; keeping that rule by remembering it at
 * every call site is not keeping it at all, so it is mechanical here.
 */

const MAX_LENGTH = 200;
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
  [/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]"],
  [/\b(bearer|basic)\s+[\w.~+/=-]+/gi, "$1 [redacted]"],
  /*
   * Any assignment whose name ends in a credential word. The earlier pattern
   * could not match `MERCADO_PAGO_ACCESS_TOKEN=` at all — `_` is a word
   * character, so there is no `\b` before `TOKEN` — and a provider SDK quoting
   * its own configuration back is exactly how one of these reaches a message.
   */
  [/[\w-]*(?:token|secret|password|key|credential|session)=[\w.~+/=-]+/gi, "[redacted]"],
  // A PIX "copia e cola" always begins with the EMV payload-format indicator.
  [/\b000201[\w.*$%:;,+/=-]{16,}/g, "[pix-payload]"],
  [/\b(sk|pk|rk)_(live|test)_[\w-]+/gi, "[key]"],
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
  const deepest = deepestCause(error);
  return {
    // The name is sanitised too. It looks like a constant, and is — until a
    // library builds one out of a response it received.
    name: sanitize(deepest.name),
    message: sanitize(deepest.message),
    frames: safeFrames(deepest.stack),
  };
}

function safeFrames(stack: string | undefined): readonly string[] {
  if (stack === undefined) {
    return [];
  }
  return (
    stack
      .split("\n")
      .map((line) => line.trim())
      // Only the frames. Anything that is not one is part of the message.
      .filter((line) => line.startsWith("at "))
      .slice(0, MAX_FRAMES)
      /*
       * Sanitised like everything else. Frames are file paths and function
       * names, which carry nothing about a request — until a stack is built by
       * hand, or a path carries a query string, and then this is the one thing
       * being forwarded verbatim.
       */
      .map(sanitize)
  );
}

function deepestCause(error: Error): Error {
  let current = error;
  // Bounded: a cause chain long enough to loop is itself a bug, not a log line.
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
 * Reduces any text to something safe to print.
 *
 * Exported because the same rule has to apply to a value in a log field, not
 * only to an error message: a PIX payload under `note:` is the same payload it
 * is under `pixPayload:`.
 */
export function sanitize(message: string): string {
  let cleaned = message;
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
