import { log } from "./logger";
import type { ErrorTracker, TrackedError } from "./tracker";

/**
 * The tracker for development and for any deployment without an error service.
 *
 * It writes through the same logger everything else uses, so a failure is
 * visible in the one place somebody is already looking, and the redaction rules
 * apply to it exactly as they apply to every other line.
 */
export class ConsoleErrorTracker implements ErrorTracker {
  readonly name = "console";

  async capture(tracked: TrackedError): Promise<void> {
    log.error(tracked.event, tracked.error, {
      ...tracked.context,
      tracker: this.name,
      ...(tracked.severity === undefined ? {} : { severity: tracked.severity }),
    });
  }
}
