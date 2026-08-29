import { afterEach, describe, expect, test } from "bun:test";
import { describeError } from "../../src/observability/errors";
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

  /*
   * Every name the codebase actually spells, pinned one by one.
   *
   * The list above used to hold exact field names and was rewritten into stems,
   * which looked strictly stronger — `token` covers `manageToken`, `cookie`
   * covers `setCookie`. It was not: `fanIdentityKey` is a substring of no stem,
   * so the supporter's pseudonymous identity started printing in full and every
   * other assertion still passed. A rewrite is only safe if the cases it must
   * keep are named somewhere it cannot quietly stop covering them.
   */
  test("redacts every sensitive field name this codebase actually writes", () => {
    const records = capture();
    log.info("every_shape", {
      Authorization: "Bearer abc",
      "set-cookie": "co_manage=abc",
      manageToken: "abc",
      unsubToken: "abc",
      admin_api_secret: "abc",
      accessToken: "abc",
      apiKey: "abc",
      fanIdentityKey: "hmac",
      supporterEmail: "ana@example.com",
      pixPayload: "000201...",
      qrCode: "data:image/png",
      copyPaste: "000201...",
      emv: "000201...",
    });

    const record: LogRecord = records[0] ?? { level: "info", event: "none" };
    for (const [field, value] of Object.entries(record)) {
      if (field === "level" || field === "event") {
        continue;
      }
      expect(value, field).toBe("[redacted]");
    }
  });

  test("still prints the fields an operator needs to read", () => {
    const records = capture();
    log.info("ordinary", {
      creatorSlug: "luna-verso",
      amountCents: 500,
      provider: "fake-pix",
      // Not a credential: it identifies a retry, not a person, and redacting it
      // would take the one field that makes a duplicate payment traceable.
      idempotencyKey: "boost-1",
      status: "CONFIRMED",
    });

    const record: LogRecord = records[0] ?? { level: "info", event: "none" };
    expect(record["idempotencyKey"]).toBe("boost-1");
    expect(record["amountCents"]).toBe(500);
    expect(record["status"]).toBe("CONFIRMED");
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

describe("a log line that cannot be read", () => {
  /**
   * Every one of these is a change nothing would have noticed being deleted.
   *
   * Reverting the guards individually left the suite green: the outer
   * `try/catch` in the error tracker absorbed what the logger let through, so
   * "capture resolves" kept passing while the line itself was lost or the
   * process took a throw from inside its own error handler. Each is asserted
   * here, on the logger, where the behaviour actually lives.
   */
  test("marks the field it could not read and keeps the rest", () => {
    /*
     * The whole record used to be replaced with `{ fields: "[unreadable]" }`.
     * `log.error` merges the error's own name and reason into that record, so
     * one hostile field erased the description of the failure being reported.
     */
    const records = capture();
    const fields: Record<string, unknown> = { creatorSlug: "luna-verso", amountCents: 500 };
    Object.defineProperty(fields, "hostile", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });

    log.error("payment_failed", new Error("provider said no"), fields);

    const record: LogRecord = records[0] ?? { level: "error", event: "none" };
    expect(record["hostile"]).toBe("[unreadable]");
    expect(record["creatorSlug"]).toBe("luna-verso");
    expect(record["amountCents"]).toBe(500);
    // The half a reader actually needs survives.
    expect(record["error"]).toBe("Error");
    expect(record["reason"]).toBe("provider said no");
  });

  test("turns a BigInt into something a report can carry", () => {
    /*
     * The sink has a replacer, so a BigInt reached the console fine — and the
     * error tracker, which serialises the same fields with its own
     * `JSON.stringify`, dropped the whole report. The symptom was a line
     * reading `error_report_failed` beside a test asserting `capture` resolves.
     */
    const records = capture();
    log.info("weekly_total", { amountCents: 9_007_199_254_740_993n });

    const record: LogRecord = records[0] ?? { level: "info", event: "none" };
    expect(record["amountCents"]).toBe("9007199254740993");
    expect(() => JSON.stringify(record)).not.toThrow();
  });

  test("survives an error whose own name and message throw", () => {
    // `describeError` is called from Elysia's `onError`, the handler of last
    // resort, so a throw here is an unhandled exception inside the thing that
    // handles exceptions.
    const records = capture();
    const hostile = new Error("readable");
    Object.defineProperty(hostile, "message", {
      get() {
        throw new Error("boom");
      },
    });

    expect(() => log.error("api_error", hostile)).not.toThrow();
    const record: LogRecord = records[0] ?? { level: "error", event: "none" };
    // Named, so a reader knows an error existed and could not be read — rather
    // than that there was no error.
    expect(record["error"]).toBe("Unreadable");
  });

  test("prints the stack frames sanitised, not verbatim", () => {
    // Frames are file paths and function names, which carry nothing about a
    // request — until a stack is built by hand, and then this is the one thing
    // being forwarded as it arrived.
    const forged = new Error("failed");
    forged.stack = "Error: failed\n    at handler (/app/x.ts?email=ana.silva@example.com:1:1)";

    const described = describeError(forged);
    expect(described.frames).toHaveLength(1);
    expect(described.frames[0]).not.toContain("ana.silva");
    expect(described.frames[0]).toContain("[email]");
  });
});
