import { beforeEach, describe, expect, test } from "bun:test";
import { ConsoleErrorTracker } from "../../src/observability/console-tracker";
import { type LogRecord, resetLogSink, setLogSink } from "../../src/observability/logger";
import { parseSentryDsn, SentryErrorTracker } from "../../src/observability/sentry";
import { NullErrorTracker } from "../../src/observability/tracker";

const DSN = "https://abc123def456@o987654.ingest.sentry.io/4505";

describe("reading a Sentry DSN", () => {
  test("takes the key, the host and the project out of it", () => {
    const parsed = parseSentryDsn(DSN);
    expect(parsed?.publicKey).toBe("abc123def456");
    expect(parsed?.envelopeUrl).toBe("https://o987654.ingest.sentry.io/api/4505/envelope/");
  });

  test("accepts a DSN with a path prefix, which self-hosted instances have", () => {
    const parsed = parseSentryDsn("https://key@sentry.example.com/prefix/42");
    expect(parsed?.envelopeUrl).toBe("https://sentry.example.com/prefix/api/42/envelope/");
  });

  test("refuses anything that is not a usable DSN, rather than half-working", () => {
    for (const invalid of [
      "",
      "not-a-url",
      "https://sentry.io/4505",
      "https://key@sentry.io",
      "https://key@sentry.io/",
      "ftp://key@sentry.io/1",
    ]) {
      expect(parseSentryDsn(invalid), invalid).toBe(null);
    }
  });
});

describe("what reaches the tracker", () => {
  type Sent = { readonly url: string; readonly headers: Headers; readonly body: string };

  function trackerWithCapture(): { tracker: SentryErrorTracker; sent: Sent[] } {
    const sent: Sent[] = [];
    const tracker = new SentryErrorTracker({
      dsn: DSN,
      environment: "test",
      transport: async (url, init) => {
        sent.push({
          url,
          headers: new Headers(init.headers),
          body: typeof init.body === "string" ? init.body : "",
        });
      },
    });
    return { tracker, sent };
  }

  function envelopeEvent(body: string): Record<string, unknown> {
    const lines = body.trim().split("\n");
    const last = lines[lines.length - 1] ?? "{}";
    const parsed: unknown = JSON.parse(last);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("envelope item is not an object");
    }
    return { ...parsed };
  }

  test("posts an envelope to the DSN's endpoint, authenticated with the public key", async () => {
    const { tracker, sent } = trackerWithCapture();
    await tracker.capture({ event: "request_failed", error: new Error("boom") });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://o987654.ingest.sentry.io/api/4505/envelope/");
    expect(sent[0]?.headers.get("x-sentry-auth")).toContain("sentry_key=abc123def456");
    expect(sent[0]?.headers.get("content-type")).toBe("application/x-sentry-envelope");
  });

  test("carries the error's type and message", async () => {
    const { tracker, sent } = trackerWithCapture();
    await tracker.capture({ event: "request_failed", error: new TypeError("no such thing") });

    const event = envelopeEvent(sent[0]?.body ?? "");
    expect(JSON.stringify(event)).toContain("TypeError");
    expect(JSON.stringify(event)).toContain("no such thing");
  });

  test("never sends an address, even when the error message contains one", async () => {
    const { tracker, sent } = trackerWithCapture();
    await tracker.capture({
      event: "email_failed",
      error: new Error("could not deliver to alguem@example.com"),
    });

    expect(sent[0]?.body).not.toContain("alguem@example.com");
    expect(sent[0]?.body).toContain("[email]");
  });

  test("never sends the query parameters a driver appends to a failed statement", async () => {
    const { tracker, sent } = trackerWithCapture();
    const query = new Error('insert into payments ... params: ["pix-secret-payload"]');
    await tracker.capture({ event: "db_failed", error: query });

    expect(sent[0]?.body).not.toContain("pix-secret-payload");
  });

  test("redacts a context field that must never leave the process", async () => {
    const { tracker, sent } = trackerWithCapture();
    await tracker.capture({
      event: "request_failed",
      error: new Error("boom"),
      context: {
        cookie: "co_admin_session=abc",
        authorization: "Bearer xyz",
        manageToken: "tok_123",
        supporterEmail: "alguem@example.com",
        adminApiSecret: "s3cr3t",
        creatorSlug: "ana",
      },
    });

    const body = sent[0]?.body ?? "";
    for (const secret of ["co_admin_session=abc", "Bearer xyz", "tok_123", "s3cr3t"]) {
      expect(body, secret).not.toContain(secret);
    }
    expect(body).not.toContain("alguem@example.com");
    // The harmless field still arrives, or the report is useless.
    expect(body).toContain("ana");
  });

  test("sends stack frames but not the message line, which is the part that leaks", async () => {
    const { tracker, sent } = trackerWithCapture();
    await tracker.capture({
      event: "request_failed",
      error: new Error("falhou para alguem@example.com"),
    });

    const body = sent[0]?.body ?? "";
    expect(body).not.toContain("alguem@example.com");
    expect(body).toContain("frames");
  });

  test("tags the request so a report and its log lines can be found together", async () => {
    const { tracker, sent } = trackerWithCapture();
    await tracker.capture({
      event: "request_failed",
      error: new Error("boom"),
      requestId: "req-abc-123",
    });
    expect(sent[0]?.body).toContain("req-abc-123");
  });

  test("says which environment it came from", async () => {
    const { tracker, sent } = trackerWithCapture();
    await tracker.capture({ event: "request_failed", error: new Error("boom") });
    expect(sent[0]?.body).toContain('"environment":"test"');
  });
});

describe("a tracker that cannot report", () => {
  test("swallows a transport failure rather than turning one fault into two", async () => {
    const tracker = new SentryErrorTracker({
      dsn: DSN,
      environment: "test",
      transport: async () => {
        throw new Error("the network is down");
      },
    });

    // The caller is already handling a failure; a throw here would replace it.
    expect(
      await tracker
        .capture({ event: "request_failed", error: new Error("boom") })
        .then(() => "resolved"),
    ).toBe("resolved");
  });

  test("a DSN it cannot read makes it inert, not broken", async () => {
    const sent: string[] = [];
    const tracker = new SentryErrorTracker({
      dsn: "nonsense",
      environment: "test",
      transport: async (url) => {
        sent.push(url);
      },
    });
    await tracker.capture({ event: "request_failed", error: new Error("boom") });
    expect(sent).toEqual([]);
  });
});

describe("the console tracker", () => {
  const records: LogRecord[] = [];

  beforeEach(() => {
    records.length = 0;
    setLogSink((record) => records.push(record));
  });

  test("writes the failure to the log, described rather than printed", async () => {
    await new ConsoleErrorTracker().capture({
      event: "request_failed",
      error: new Error("falhou para alguem@example.com"),
    });
    resetLogSink();

    expect(records).toHaveLength(1);
    expect(records[0]?.level).toBe("error");
    expect(JSON.stringify(records[0])).not.toContain("alguem@example.com");
  });

  test("redacts a context field the log would refuse anyway", async () => {
    await new ConsoleErrorTracker().capture({
      event: "request_failed",
      error: new Error("boom"),
      context: { cookie: "co_admin_session=abc" },
    });
    resetLogSink();
    expect(JSON.stringify(records[0])).not.toContain("co_admin_session=abc");
  });
});

describe("the null tracker", () => {
  test("does nothing, and does it without throwing", async () => {
    expect(
      await new NullErrorTracker()
        .capture({ event: "request_failed", error: new Error("boom") })
        .then(() => "resolved"),
    ).toBe("resolved");
  });
});
