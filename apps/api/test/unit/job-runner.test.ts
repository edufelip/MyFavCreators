import { describe, expect, test } from "bun:test";
import { runJob } from "../../src/jobs/run";
import { type LogRecord, resetLogSink, setLogSink } from "../../src/observability/logger";
import type { ErrorTracker, TrackedError } from "../../src/observability/tracker";

function recordingTracker(): { tracker: ErrorTracker; captured: TrackedError[] } {
  const captured: TrackedError[] = [];
  return {
    captured,
    tracker: {
      name: "recording",
      capture: async (tracked) => {
        captured.push(tracked);
      },
    },
  };
}

function harness() {
  const { tracker, captured } = recordingTracker();
  const records: LogRecord[] = [];
  const closed: string[] = [];
  const exits: number[] = [];
  setLogSink((record) => records.push(record));
  return {
    captured,
    records,
    closed,
    exits,
    hooks: {
      tracker,
      close: async () => {
        closed.push("closed");
      },
      exit: (code: number) => {
        exits.push(code);
      },
    },
  };
}

describe("a job that succeeds", () => {
  test("logs its summary, closes the database and does not exit non-zero", async () => {
    const h = harness();
    await runJob("weekly-rollover", async () => "closed 1 period", h.hooks);
    resetLogSink();

    expect(h.records.some((record) => record.event === "job_finished")).toBe(true);
    expect(h.closed).toEqual(["closed"]);
    expect(h.exits).toEqual([]);
    expect(h.captured).toEqual([]);
  });
});

describe("a job that throws", () => {
  test("reports the failure rather than dying quietly", async () => {
    const h = harness();
    await runJob(
      "weekly-rollover",
      async () => {
        throw new Error("the database went away");
      },
      h.hooks,
    );
    resetLogSink();

    expect(h.captured).toHaveLength(1);
    expect(h.captured[0]?.event).toBe("job_failed");
    expect(h.captured[0]?.severity).toBe("fatal");
    expect(h.captured[0]?.context?.["job"]).toBe("weekly-rollover");
  });

  test("exits non-zero, so a scheduler knows the run failed", async () => {
    const h = harness();
    await runJob(
      "weekly-recap",
      async () => {
        throw new Error("boom");
      },
      h.hooks,
    );
    resetLogSink();
    expect(h.exits).toEqual([1]);
  });

  test("still closes the database, so a failed run leaks no connection", async () => {
    const h = harness();
    await runJob(
      "payment-reconcile",
      async () => {
        throw new Error("boom");
      },
      h.hooks,
    );
    resetLogSink();
    expect(h.closed).toEqual(["closed"]);
  });

  test("never lets the failure escape, so the exit code is the one it chose", async () => {
    const h = harness();
    const outcome = await runJob(
      "weekly-recap",
      async () => {
        throw new Error("boom");
      },
      h.hooks,
    ).then(
      () => "resolved",
      () => "rejected",
    );
    resetLogSink();
    expect(outcome).toBe("resolved");
  });

  test("waits for the report before exiting, or nothing is ever sent", async () => {
    // Only for its side effect: the job's own log lines go to the sink rather
    // than to the test output.
    harness();
    const order: string[] = [];
    await runJob(
      "weekly-recap",
      async () => {
        throw new Error("boom");
      },
      {
        tracker: {
          name: "slow",
          capture: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            order.push("reported");
          },
        },
        close: async () => {
          order.push("closed");
        },
        exit: () => order.push("exited"),
      },
    );
    resetLogSink();
    expect(order).toEqual(["reported", "closed", "exited"]);
  });
});

describe("a job whose cleanup fails", () => {
  test("still exits non-zero rather than hanging on a broken connection", async () => {
    const h = harness();
    await runJob("weekly-recap", async () => "done", {
      ...h.hooks,
      close: async () => {
        throw new Error("could not close");
      },
    });
    resetLogSink();
    expect(h.exits).toEqual([1]);
  });
});
