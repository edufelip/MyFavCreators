import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { describeError } from "./errors";

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
const FORBIDDEN_FIELDS = new Set([
  "authorization",
  "cookie",
  "setcookie",
  "password",
  "secret",
  "token",
  "managetoken",
  "unsubtoken",
  "adminapisecret",
  "fanidentitykey",
  "supporteremail",
  "email",
  // The PIX payload is the string a person pastes into their bank. It is not a
  // credential, but it is the one field a support screenshot must never carry.
  "pixpayload",
  "qrcode",
  "copypaste",
  "emv",
]);

/** How deep a scrub descends before it stops looking. */
const MAX_SCRUB_DEPTH = 4;

function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_FIELDS.has(key.toLowerCase().replace(/[-_\s]/g, ""));
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
  const line = JSON.stringify(record);
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
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = isForbiddenKey(key) ? "[redacted]" : scrubValue(value, 1);
  }
  return safe;
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
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

function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
  const requestId = currentRequestId();
  sink({
    level,
    event,
    ...(requestId === undefined ? {} : { requestId }),
    ...scrubFields(fields),
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
    emit("error", event, { ...fields, error: described.name, reason: described.message });
  },
};
