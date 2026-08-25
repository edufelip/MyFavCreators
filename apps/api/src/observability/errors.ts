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
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

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
    name: deepest.name,
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

function sanitize(message: string): string {
  let cleaned = message;
  for (const marker of PARAMETER_MARKERS) {
    const at = cleaned.toLowerCase().indexOf(marker);
    if (at >= 0) {
      cleaned = cleaned.slice(0, at);
    }
  }
  cleaned = cleaned.replace(EMAIL_PATTERN, "[email]").replace(/\s+/g, " ").trim();
  return cleaned.length > MAX_LENGTH ? `${cleaned.slice(0, MAX_LENGTH)}...` : cleaned;
}
