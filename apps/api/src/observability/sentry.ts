import { randomUUID } from "node:crypto";
import { describeError } from "./errors";
import { log, scrubFields } from "./logger";
import type { ErrorTracker, TrackedError } from "./tracker";

/**
 * Reporting failures to Sentry, over its envelope endpoint.
 *
 * Written against `fetch` rather than the SDK on purpose. The SDK installs
 * global handlers, patches the runtime and pulls in a large dependency tree to
 * do things this application already does for itself — request correlation,
 * structured logging, redaction. What is actually needed is one POST, and one
 * POST is what this is.
 *
 * The important consequence is that nothing is captured automatically. Every
 * report is written here, from data that has already been sanitised, which is
 * the only way to be sure a PIX payload or an address never leaves the process
 * because an SDK decided to attach the request body.
 */
export type SentryDsn = {
  readonly publicKey: string;
  readonly envelopeUrl: string;
};

export type SentryTransport = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Record<string, string>;
    readonly body: string;
  },
) => Promise<void>;

/**
 * Reads a DSN, or returns `null`.
 *
 * `https://{publicKey}@{host}/{optional/path}/{projectId}`. Anything that is
 * not that shape returns null and makes the tracker inert: a half-parsed DSN
 * would send reports somewhere unintended, which is worse than sending none.
 */
export function parseSentryDsn(dsn: string): SentryDsn | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  const publicKey = url.username;
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const projectId = segments.pop();
  if (publicKey === "" || projectId === undefined || !/^\d+$/.test(projectId)) {
    return null;
  }

  const prefix = segments.length === 0 ? "" : `/${segments.join("/")}`;
  return {
    publicKey,
    envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
  };
}

export type SentryOptions = {
  readonly dsn: string;
  readonly environment: string;
  readonly release?: string;
  /** Overridden in tests. Production uses `fetch`. */
  readonly transport?: SentryTransport;
};

export function isSentryConfigured(dsn: string | undefined): boolean {
  return dsn !== undefined && parseSentryDsn(dsn) !== null;
}

export class SentryErrorTracker implements ErrorTracker {
  readonly name = "sentry";

  private readonly dsn: SentryDsn | null;
  private readonly transport: SentryTransport;

  constructor(private readonly options: SentryOptions) {
    this.dsn = parseSentryDsn(options.dsn);
    this.transport = options.transport ?? defaultTransport;
    if (this.dsn === null) {
      log.warn("sentry_dsn_unreadable", { tracker: this.name });
    }
  }

  async capture(tracked: TrackedError): Promise<void> {
    if (this.dsn === null) {
      return;
    }

    const described = describeError(tracked.error);
    const eventId = randomUUID().replace(/-/g, "");
    const header = JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() });
    const body = JSON.stringify({
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "node",
      logger: "creator-outdoor-api",
      level: tracked.severity ?? "error",
      environment: this.options.environment,
      ...(this.options.release === undefined ? {} : { release: this.options.release }),
      transaction: tracked.event,
      tags: {
        event: tracked.event,
        ...(tracked.requestId === undefined ? {} : { request_id: tracked.requestId }),
      },
      // Scrubbed with the same list the logger uses, so a field that may not
      // reach a log file cannot reach a third party either.
      extra: scrubFields(tracked.context ?? {}),
      exception: {
        values: [
          {
            type: described.name,
            value: described.message,
            stacktrace: { frames: described.frames.map((frame) => ({ filename: frame })) },
          },
        ],
      },
    });

    try {
      await this.transport(this.dsn.envelopeUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-sentry-envelope",
          "x-sentry-auth": [
            "Sentry sentry_version=7",
            "sentry_client=creator-outdoor/1",
            `sentry_key=${this.dsn.publicKey}`,
          ].join(", "),
        },
        body: `${header}\n${JSON.stringify({ type: "event" })}\n${body}\n`,
      });
    } catch (error) {
      // The caller is already handling a failure. Losing the report is a much
      // smaller problem than replacing their error with this one.
      log.error("error_report_failed", error, { tracker: this.name });
    }
  }
}

const defaultTransport: SentryTransport = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    // The body is Sentry's, not ours, and it is not worth logging.
    throw new Error(`Sentry responded ${response.status}`);
  }
};
