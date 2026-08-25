import { log } from "../observability/logger";
import type { ErrorTracker } from "../observability/tracker";

export type JobHooks = {
  readonly tracker: ErrorTracker;
  readonly close: () => Promise<void>;
  readonly exit: (code: number) => void;
};

/**
 * Runs a scheduled job and makes sure somebody hears about it if it fails.
 *
 * A job is the one part of the system with no request behind it and nobody
 * watching. Without this, a reconciliation run that throws prints a stack trace
 * to a log nobody reads, exits, and the next thing anybody notices is a
 * customer asking where their refund went.
 *
 * Three things are guaranteed here. The failure is reported *and waited for* —
 * a fire-and-forget report from a process that is about to exit is a report
 * that never leaves. The database is closed either way, so a failed run leaks
 * no connection. And the exit code is non-zero, which is the only part a
 * scheduler actually reads.
 */
export async function runJob(
  name: string,
  body: () => Promise<string>,
  hooks: JobHooks,
): Promise<void> {
  let failed = false;

  try {
    const summary = await body();
    log.info("job_finished", { job: name, summary });
  } catch (error) {
    failed = true;
    log.error("job_failed", error, { job: name });
    await hooks.tracker.capture({
      event: "job_failed",
      error,
      severity: "fatal",
      context: { job: name },
    });
  }

  try {
    await hooks.close();
  } catch (error) {
    failed = true;
    log.error("job_cleanup_failed", error, { job: name });
  }

  if (failed) {
    hooks.exit(1);
  }
}
