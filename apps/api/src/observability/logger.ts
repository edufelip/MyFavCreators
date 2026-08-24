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

/** Values a log line may never carry, whatever a caller passes. */
const FORBIDDEN_FIELDS = new Set([
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
  "manageToken",
  "unsubToken",
  "adminApiSecret",
  "fanIdentityKey",
  "supporterEmail",
  "email",
]);

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

function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
  const requestId = currentRequestId();
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      safe[key] = "[redacted]";
      continue;
    }
    safe[key] = value;
  }
  sink({ level, event, ...(requestId === undefined ? {} : { requestId }), ...safe });
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
