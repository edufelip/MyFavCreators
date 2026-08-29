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

  test("redacts however the key was spelled", async () => {
    /*
     * A header object arrives with whatever casing and separators the sender
     * used. Matching the exact spelling meant `Cookie`, `set-cookie` and
     * `supporter_email` all walked straight through a list that names their
     * camelCase twins.
     */
    const { tracker, sent } = trackerWithCapture();
    await tracker.capture({
      event: "request_failed",
      error: new Error("boom"),
      context: {
        Cookie: "co_admin_session=abc",
        Authorization: "Bearer xyz",
        "set-cookie": "co_sid=zzz",
        supporter_email: "alguem@example.com",
        PIXPAYLOAD: "00020126580014br.gov.bcb.pix",
      },
    });

    const body = sent[0]?.body ?? "";
    for (const secret of ["co_admin_session=abc", "Bearer xyz", "co_sid=zzz", "br.gov.bcb.pix"]) {
      expect(body, secret).not.toContain(secret);
    }
    expect(body).not.toContain("alguem@example.com");
  });

  test("redacts a secret nested inside a context object", async () => {
    /*
     * `{ headers: { cookie } }` is exactly the shape somebody reaches for when
     * a request fails, and a flat scrub looked right for as long as nobody had.
     */
    const { tracker, sent } = trackerWithCapture();
    await tracker.capture({
      event: "request_failed",
      error: new Error("boom"),
      context: {
        request: { headers: { cookie: "co_admin_session=abc" }, route: "/v1/boosts" },
        payer: [{ email: "alguem@example.com" }],
      },
    });

    const body = sent[0]?.body ?? "";
    expect(body).not.toContain("co_admin_session=abc");
    expect(body).not.toContain("alguem@example.com");
    expect(body).toContain("/v1/boosts");
  });

  test("survives a context that refers to itself", async () => {
    const { tracker, sent } = trackerWithCapture();
    const cyclic: Record<string, unknown> = { creatorSlug: "ana" };
    cyclic["self"] = cyclic;

    await tracker.capture({ event: "request_failed", error: new Error("boom"), context: cyclic });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toContain("ana");
  });

  test("never sends a credential or a PIX payload quoted inside the message", async () => {
    /*
     * An error message is written by whoever threw it, which includes libraries
     * and providers. What ends up in one is not something the call sites can be
     * trusted to have thought about, so it is stripped here.
     */
    const { tracker, sent } = trackerWithCapture();
    const leaky = [
      // A JWT, so this pins the bearer rule itself rather than the `sk_live`
      // one — deleting the bearer pattern used to leave the suite green.
      "refused for Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdef.ghijkl",
      "refused for Authorization: Basic dXNlcjpwYXNzd29yZA==",
      "MERCADO_PAGO_ACCESS_TOKEN=APP_USR-9999-aaaa was rejected",
      "refused for Authorization: Bearer sk_live_abcdef123456",
      "cookie co_admin_session=abcdef123456 rejected",
      "provider refused 00020126580014br.gov.bcb.pix0136abcdef-1234-5678-9012-abcdefabcdef5204",
    ].join(" | ");

    await tracker.capture({ event: "provider_failed", error: new Error(leaky) });

    const body = sent[0]?.body ?? "";
    for (const secret of [
      "sk_live_abcdef123456",
      "co_admin_session=abcdef123456",
      "br.gov.bcb.pix",
      "eyJhbGciOiJIUzI1NiJ9.abcdef.ghijkl",
      "dXNlcjpwYXNzd29yZA==",
      "APP_USR-9999-aaaa",
    ]) {
      expect(body, secret).not.toContain(secret);
    }
  });

  test("sends stack frames, and only the frames — never the stack's first line", async () => {
    /*
     * A stack begins `Name: message`, and the message is the half that can carry
     * a driver's parameters. The sanitised message is sent once, as the
     * exception's value; the raw one must not arrive a second time inside the
     * frames.
     */
    const { tracker, sent } = trackerWithCapture();
    await tracker.capture({
      event: "request_failed",
      error: new Error("falhou para alguem@example.com"),
    });

    const body = sent[0]?.body ?? "";
    expect(body).not.toContain("alguem@example.com");
    expect(body).toContain("frames");
    // Every frame is a frame, not a message line.
    const frames = [...body.matchAll(/"filename":"([^"]*)"/g)].map((match) => match[1] ?? "");
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((frame) => frame.startsWith("at "))).toBe(true);
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

describe("a tracker that is handed something hostile", () => {
  /*
   * `capture` is fire-and-forget from the API's error handler, on a request
   * that has already failed. A rejection there is an unhandled rejection in the
   * worst possible place, so nothing the caller passes may produce one.
   */
  function trackerFor(sent: string[]): SentryErrorTracker {
    return new SentryErrorTracker({
      dsn: "https://abc123def456@o987654.ingest.sentry.io/4505",
      environment: "test",
      transport: async (_url, init) => {
        sent.push(typeof init.body === "string" ? init.body : "");
      },
    });
  }

  test("does not reject on a context field whose getter throws", async () => {
    const sent: string[] = [];
    const hostile = {
      get creatorSlug(): string {
        throw new Error("no");
      },
    };
    expect(
      await trackerFor(sent)
        .capture({ event: "request_failed", error: new Error("boom"), context: hostile })
        .then(() => "resolved"),
    ).toBe("resolved");
  });

  test("does not reject on a value JSON cannot serialise", async () => {
    const sent: string[] = [];
    expect(
      await trackerFor(sent)
        .capture({
          event: "request_failed",
          error: new Error("boom"),
          context: { attempts: 3n },
        })
        .then(() => "resolved"),
    ).toBe("resolved");
  });

  test("redacts a credential named however the caller named it", async () => {
    const sent: string[] = [];
    await trackerFor(sent).capture({
      event: "request_failed",
      error: new Error("boom"),
      context: {
        accessToken: "APP_USR-1111",
        apiKey: "key-2222",
        sessionToken: "sess-3333",
        cookies: "co_sid=4444",
        creatorSlug: "ana",
      },
    });

    const body = sent[0] ?? "";
    for (const secret of ["APP_USR-1111", "key-2222", "sess-3333", "co_sid=4444"]) {
      expect(body, secret).not.toContain(secret);
    }
    expect(body).toContain("ana");
  });

  test("redacts a secret that arrives as a value rather than under its own key", async () => {
    const sent: string[] = [];
    await trackerFor(sent).capture({
      event: "request_failed",
      error: new Error("boom"),
      context: {
        note: "00020126580014br.gov.bcb.pix0136abcdef-1234-5678-9012-abcdefabcdef5204",
        detail: "used sk_live_zzzzzzzzzzzz",
      },
    });

    const body = sent[0] ?? "";
    expect(body).not.toContain("br.gov.bcb.pix");
    expect(body).not.toContain("sk_live_zzzzzzzzzzzz");
  });

  test("redacts a secret smuggled into the error's name", async () => {
    const sent: string[] = [];
    const named = new Error("boom");
    named.name = "Error: Bearer eyJhbGciOiJIUzI1NiJ9.zzz.yyy";
    await trackerFor(sent).capture({ event: "request_failed", error: named });
    expect(sent[0] ?? "").not.toContain("eyJhbGciOiJIUzI1NiJ9.zzz.yyy");
  });
});
