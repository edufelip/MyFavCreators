import { afterEach, describe, expect, test } from "bun:test";
import {
  currentRequestId,
  type LogRecord,
  log,
  resetLogSink,
  resolveRequestId,
  setLogSink,
  withRequestId,
} from "../../src/observability/logger";

function capture(): LogRecord[] {
  const records: LogRecord[] = [];
  setLogSink((record) => records.push(record));
  return records;
}

afterEach(() => {
  resetLogSink();
});

describe("log lines", () => {
  test("carry a level and an event name", () => {
    const records = capture();
    log.info("payment_confirmed", { amountCents: 500 });

    expect(records).toHaveLength(1);
    expect(records[0]?.level).toBe("info");
    expect(records[0]?.event).toBe("payment_confirmed");
    expect(records[0]?.["amountCents"]).toBe(500);
  });

  test("serialize to one JSON object per line", () => {
    const records = capture();
    log.warn("webhook_rejected", { provider: "fake-pix" });
    // A log that has to be parsed by regular expression is a log nobody queries.
    const parsed: unknown = JSON.parse(JSON.stringify(records[0]));
    expect(parsed).toEqual({ level: "warn", event: "webhook_rejected", provider: "fake-pix" });
  });

  test("never print a field that could carry a credential or an address", () => {
    const records = capture();
    log.info("suspicious", {
      token: "secret-token",
      cookie: "co_manage=abc",
      email: "ana@example.com",
      supporterEmail: "ana@example.com",
      fanIdentityKey: "hmac",
      creatorSlug: "luna-verso",
    });

    const record: LogRecord = records[0] ?? { level: "info", event: "none" };
    for (const field of ["token", "cookie", "email", "supporterEmail", "fanIdentityKey"]) {
      expect(record[field], field).toBe("[redacted]");
    }
    // Everything that is not sensitive is still there to read.
    expect(record["creatorSlug"]).toBe("luna-verso");
  });

  test("describe an error rather than printing it", () => {
    const records = capture();
    const cause = new Error('relation "x" does not exist');
    cause.name = "PostgresError";
    log.error("query_failed", new Error("Failed query: insert params: ana@example.com", { cause }));

    const record: LogRecord = records[0] ?? { level: "error", event: "none" };
    expect(record["error"]).toBe("PostgresError");
    expect(record["reason"]).toBe('relation "x" does not exist');
    expect(JSON.stringify(record)).not.toContain("ana@example.com");
  });
});

describe("request correlation", () => {
  test("stamps every line produced inside a request", () => {
    const records = capture();
    withRequestId("req-123", () => {
      log.info("first");
      log.info("second");
    });

    expect(records.map((record) => record.requestId)).toEqual(["req-123", "req-123"]);
  });

  test("follows an async call chain, which is where the useful lines are", async () => {
    const records = capture();
    await withRequestId("req-async", async () => {
      await Promise.resolve();
      log.info("after_await");
    });

    expect(records[0]?.requestId).toBe("req-async");
  });

  test("leaves lines outside a request unstamped rather than inventing an id", () => {
    const records = capture();
    log.info("job_started");
    expect(records[0]?.requestId).toBeUndefined();
    expect(currentRequestId()).toBeUndefined();
  });

  test("honours an upstream id so a trace spans the whole hop", () => {
    expect(resolveRequestId("edge-7f3a-19bc")).toBe("edge-7f3a-19bc");
  });

  test("refuses an id that could forge a log line", () => {
    // A caller who chose this freely could embed a newline and write their own.
    for (const forged of ["short", "a\nlevel=error", 'x".}{"', "a".repeat(200), ""]) {
      expect(resolveRequestId(forged), forged).not.toBe(forged);
    }
  });

  test("invents an id when there is none", () => {
    const generated = resolveRequestId(null);
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId(null)).not.toBe(generated);
  });
});
