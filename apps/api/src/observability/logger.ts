import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { describeError, sanitize } from "./errors";

/**
 * Structured logging.
 *
 * One JSON object per line, because a log that has to be parsed by regular
 * expression is a log nobody queries. Every line carries the request id that
 * produced it, so a payment, its webhook, its follow-ups and the failure three
 * layers down can be pulled up together.
 *
 * What may appear in a line is decided here rather than at each call site: an
 * `error` field goes through `describeError`, which drops the query parameters
 * a driver appends and redacts anything shaped like an address. There is no way
 * to pass a raw error through this logger.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Readonly<Record<string, unknown>>;

export type LogRecord = {
  readonly level: LogLevel;
  readonly event: string;
  readonly requestId?: string;
  readonly [field: string]: unknown;
};

export type LogSink = (record: LogRecord) => void;

const REQUEST_CONTEXT = new AsyncLocalStorage<{ readonly requestId: string }>();

/**
 * Values a log line may never carry, whatever a caller passes.
 *
 * Compared with the key lowercased and its separators removed, so `Cookie`,
 * `set-cookie` and `supporter_email` are the same key as `cookie` and
 * `supporterEmail`. Matching the exact spelling meant a header object — whose
 * keys arrive however the sender wrote them — walked straight through.
 */
const FORBIDDEN_STEMS = [
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
  "apikey",
  "credential",
  "email",
  // Names that carry the same things and match no stem above: `jwt` and
  // `bearer` are whole credentials, `pwd` is the abbreviation everybody uses,
  // `auth` covers `auth`, `authHeader` and `basicAuth`.
  "jwt",
  "bearer",
  "pwd",
  "auth",
  "signature",
  "hmac",
  "totp",
  /*
   * The supporter's pseudonymous identity: an HMAC of their address, which is
   * not an address but stands in for one everywhere. It is the one entry here
   * that no generic stem covers, and it fell out of this list once already
   * when exact names became stems — hence its own test below the others.
   */
  "identitykey",
  // The PIX payload is the string a person pastes into their bank. It is not a
  // credential, but it is the one field a support screenshot must never carry.
  "pixpayload",
  "qrcode",
  "copypaste",
  "emv",
] as const;

/** How deep a scrub descends before it stops looking. */
const MAX_SCRUB_DEPTH = 4;

/**
 * Stems rather than exact names.
 *
 * Folding the spelling fixed `Cookie` and `set-cookie`; it did nothing for
 * `cookies`, `accessToken`, `apiKey`, `sessionToken` or `refreshToken`, which
 * are the words a caller actually reaches for. A field list that has to
 * enumerate every synonym is a list that will be one synonym behind.
 */
function isForbiddenKey(key: string): boolean {
  const folded = key.toLowerCase().replace(/[-_\s]/g, "");
  return FORBIDDEN_STEMS.some((stem) => folded.includes(stem));
}

let sink: LogSink = defaultSink;

/** Replaces the destination. Tests use this; production leaves it alone. */
export function setLogSink(next: LogSink): void {
  sink = next;
}

export function resetLogSink(): void {
  sink = defaultSink;
}

function defaultSink(record: LogRecord): void {
  // A BigInt has no JSON form and throws rather than serialising, which would
  // turn a log line into a second fault.
  const line = JSON.stringify(record, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  if (record.level === "error") {
    console.error(line);
  } else if (record.level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

/** Runs work with a request id every log line inside it will carry. */
export function withRequestId<TResult>(requestId: string, work: () => TResult): TResult {
  return REQUEST_CONTEXT.run({ requestId }, work);
}

/**
 * Binds a request id to everything that runs after this call.
 *
 * `run()` needs a function to wrap, which a framework hook that only observes
 * the request cannot provide; `enterWith` is the form meant for exactly that,
 * and each request begins in its own async context, so one request cannot pick
 * up another's id.
 */
export function enterRequestId(requestId: string): void {
  REQUEST_CONTEXT.enterWith({ requestId });
}

export function currentRequestId(): string | undefined {
  return REQUEST_CONTEXT.getStore()?.requestId;
}

/**
 * The id for an incoming request.
 *
 * An upstream proxy's `x-request-id` is honoured so a trace spans the whole
 * hop, but only when it looks like an id: the value reaches logs, and a caller
 * who could choose it freely could forge log lines by embedding newlines.
 */
export function resolveRequestId(header: string | null): string {
  if (header !== null && /^[A-Za-z0-9._:-]{8,128}$/.test(header)) {
    return header;
  }
  return randomUUID();
}

/**
 * Replaces the value of any field that must never leave the process.
 *
 * Redacted rather than dropped: a report that silently omits a field reads as
 * "there was no cookie", which is a different and more misleading statement
 * than "there was one and you may not see it".
 *
 * Descends into nested objects and arrays. A flat pass looked right for as long
 * as every caller happened to pass flat fields, and `{ headers: { cookie } }` is
 * exactly the shape somebody reaches for when a request fails. Bounded, because
 * a cycle or a huge payload must not turn a log line into a hang.
 *
 * Exported because the error tracker sends fields to a third party and has to
 * apply exactly the same rule. One list, one function — a second copy is a
 * second thing to forget to update.
 */
export function scrubFields(fields: LogFields): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  /*
   * Reading the fields can itself throw — a getter that raises, a proxy. This
   * runs while something has already gone wrong, so it must not be the thing
   * that goes wrong next.
   *
   * Guarded per key rather than around the loop. Around the loop, one hostile
   * field replaced the *whole* record with `{ fields: "[unreadable]" }` — and
   * `log.error` merges the error's own name and reason into that same object,
   * so a single unreadable field erased the description of the failure being
   * reported. Marking the one field that could not be read keeps the rest,
   * which is the half a reader needs.
   */
  let keys: string[];
  try {
    keys = Object.keys(fields);
  } catch {
    // Even enumerating can throw, on a proxy with a hostile `ownKeys`.
    return { fields: "[unreadable]" };
  }
  for (const key of keys) {
    try {
      safe[key] = isForbiddenKey(key) ? "[redacted]" : scrubValue(fields[key], 1);
    } catch {
      safe[key] = "[unreadable]";
    }
  }
  return safe;
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    // Keys were checked; values were not. A PIX payload under `note:` is the
    // same payload it is under `pixPayload:`.
    return sanitize(value);
  }
  /*
   * Converted here, not only at the log sink.
   *
   * The sink has a replacer, so a BigInt reaches the console fine — but the
   * error tracker serialises these same fields with its own `JSON.stringify`,
   * which throws on one, and the whole report is dropped. The visible symptom
   * was a line reading `error_report_failed: JSON.stringify cannot serialize
   * BigInt` while the test asserting `capture` resolves stayed green: a
   * failure that answers as though it succeeded, in the reporter.
   */
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  // `Object.entries(new Date())` is `[]`, so rebuilding one would log `{}`.
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (depth >= MAX_SCRUB_DEPTH) {
    /*
     * Truncated rather than passed through. Anything below this point has not
     * been scrubbed, so emitting it raw would be the hole this function exists
     * to close — and a structure deep enough to reach here is usually one that
     * refers to itself, which would take `JSON.stringify` with it.
     */
    return "[nested]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1));
  }
  const safe: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    safe[key] = isForbiddenKey(key) ? "[redacted]" : scrubValue(nested, depth + 1);
  }
  return safe;
}

/**
 * @param fields caller-supplied, so every read of them goes through `scrubFields`.
 * @param described built here from an error, so it is already safe and is
 *   merged last — an `error` field a caller passed cannot displace the name of
 *   the error actually being reported.
 */
function emit(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  described: Readonly<Record<string, string>> = {},
): void {
  const requestId = currentRequestId();
  sink({
    level,
    event,
    ...(requestId === undefined ? {} : { requestId }),
    ...scrubFields(fields),
    ...described,
  });
}

export const log = {
  debug: (event: string, fields?: LogFields): void => emit("debug", event, fields),
  info: (event: string, fields?: LogFields): void => emit("info", event, fields),
  warn: (event: string, fields?: LogFields): void => emit("warn", event, fields),
  /**
   * An error line. The error is described rather than printed, so a driver
   * message carrying the request's own parameters cannot reach the log.
   */
  error: (event: string, error: unknown, fields?: LogFields): void => {
    const described = describeError(error);
    /*
     * The fields are handed over untouched rather than spread into a new
     * object here. Spreading reads every getter, so a field that throws on
     * access threw *before* `scrubFields` could guard it — inside the error
     * path, which is the one place that must not raise. The guard was there;
     * the spread happened one line above it.
     */
    emit("error", event, fields, { error: described.name, reason: described.message });
  },
};
