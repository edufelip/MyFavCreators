/**
 * Where a failure goes to be noticed.
 *
 * Logs answer "what happened to this request". They do not answer "is something
 * broken right now", because nobody watches a log stream at three in the
 * morning. An error tracker is the thing that pages somebody, and it is a port
 * for the same reason the email and payment providers are: the failure paths
 * should not know which service is on the other end, and a deployment with no
 * account should still run.
 *
 * The one rule this port exists to enforce: what reaches the tracker has
 * already been through the same sanitisation as what reaches a log. An error
 * report is data leaving the process to a third party, so it gets *more*
 * scrutiny than a log line, never less.
 */
export type ErrorSeverity = "warning" | "error" | "fatal";

export type TrackedError = {
  /** A stable name for this kind of failure, not a formatted sentence. */
  readonly event: string;
  readonly error: unknown;
  readonly severity?: ErrorSeverity;
  /** Correlates the report with the log lines from the same request. */
  readonly requestId?: string;
  /** Scrubbed before it is sent; a forbidden field is redacted, not dropped. */
  readonly context?: Readonly<Record<string, unknown>>;
};

export interface ErrorTracker {
  readonly name: string;
  /**
   * Reports a failure. Never throws and never rejects: the caller is already
   * handling something that went wrong, and a tracker that can turn one fault
   * into two is worse than no tracker.
   */
  capture(tracked: TrackedError): Promise<void>;
}

/** A tracker for a deployment that has no error service. Reports nothing. */
export class NullErrorTracker implements ErrorTracker {
  readonly name = "null";

  async capture(_tracked: TrackedError): Promise<void> {
    // Deliberately empty. The failure is already in the log.
  }
}
