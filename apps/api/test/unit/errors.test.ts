import { describe, expect, test } from "bun:test";
import { describeError, sanitize } from "../../src/observability/errors";

describe("describing an error for a log", () => {
  test("keeps the name and the message of an ordinary error", () => {
    expect(describeError(new TypeError("something broke"))).toEqual({
      name: "TypeError",
      message: "something broke",
      frames: expect.any(Array),
    });
  });

  test("says nothing useful about a value that is not an error", () => {
    expect(describeError("boom")).toEqual({ name: "Unknown", message: "unknown", frames: [] });
    expect(describeError(null)).toEqual({ name: "Unknown", message: "unknown", frames: [] });
  });

  test("drops the parameters a driver appends to a failed query", () => {
    // This is the leak: the driver puts the request's own data in the message.
    const driverError = new Error(
      'Failed query: insert into "creator_claims" values ($1, $2)\n' +
        "params: 65d89caf, ana@example.com, secret-token",
    );
    const described = describeError(driverError);
    expect(described.message).not.toContain("ana@example.com");
    expect(described.message).not.toContain("secret-token");
    expect(described.message).toContain("Failed query");
  });

  test("prefers the cause, which is the half worth reading", () => {
    const cause = new Error('relation "creator_claims" does not exist');
    cause.name = "PostgresError";
    const wrapper = new Error("Failed query: insert into x params: ana@example.com", { cause });

    expect(describeError(wrapper)).toEqual({
      name: "PostgresError",
      message: 'relation "creator_claims" does not exist',
      frames: expect.any(Array),
    });
  });

  test("redacts an address that reaches a message some other way", () => {
    expect(describeError(new Error("could not deliver to ana@example.com")).message).toBe(
      "could not deliver to [email]",
    );
  });

  test("redacts every address, not only the first", () => {
    const described = describeError(new Error("ana@example.com and bia@example.com"));
    expect(described.message).toBe("[email] and [email]");
  });

  test("truncates something long enough to be a payload rather than a message", () => {
    const described = describeError(new Error("x".repeat(5_000)));
    expect(described.message.length).toBeLessThan(250);
    expect(described.message.endsWith("...")).toBe(true);
  });

  test("collapses the newlines a multi-line driver message brings", () => {
    expect(describeError(new Error("line one\n\n   line two")).message).toBe("line one line two");
  });

  test("follows a chain of causes without looping forever", () => {
    const deepest = new Error("root cause");
    let error: Error = deepest;
    for (let depth = 0; depth < 10; depth += 1) {
      error = new Error(`wrapper ${depth}`, { cause: error });
    }
    // Bounded on purpose; what matters is that it terminates and says something.
    expect(describeError(error).message.length).toBeGreaterThan(0);
  });
});

describe("the stack frames a report may carry", () => {
  test("keeps the frames and drops the line that carries the message", () => {
    const described = describeError(new Error("falhou para alguem@example.com"));

    expect(described.frames.length).toBeGreaterThan(0);
    expect(described.frames.every((frame) => frame.startsWith("at "))).toBe(true);
    expect(described.frames.join("\n")).not.toContain("alguem@example.com");
  });

  test("has none for something that is not an error", () => {
    expect(describeError("boom").frames).toEqual([]);
  });

  test("stops well before a stack long enough to be a payload", () => {
    function recurse(depth: number): Error {
      return depth === 0 ? new Error("deep") : recurse(depth - 1);
    }
    expect(describeError(recurse(80)).frames.length).toBeLessThanOrEqual(30);
  });
});

describe("what an oversized message costs", () => {
  /**
   * Measured rather than reasoned about.
   *
   * `sanitize` runs on every error message and on every string in a log field,
   * and plenty of those are as long as a request body — a claim's `profileText`
   * is 4000 characters by contract, and a body that failed to parse can be
   * anything. The redaction patterns were quadratic on input that nearly
   * matches: a run of word characters with no `=` in it made the engine try
   * every prefix length at every start position. 500 characters took 2ms, 1000
   * took 7ms, 2000 took 29ms, 4000 took 120ms — four times the work for twice
   * the input, spent producing a string this function then cuts to 200
   * characters.
   *
   * A redactor that burns a core when somebody sends it 50KB of `a` is a denial
   * of service in the one function that must never be the thing that goes
   * wrong. Two changes fixed it: every quantifier is bounded, and the scan is
   * capped just past what can be printed.
   */
  const NEARLY_MATCHING = [
    ["a run with no delimiter", (n: number) => "a".repeat(n)],
    ["a run ending in @", (n: number) => `${"a".repeat(n)}@`],
    ["word characters and underscores", (n: number) => "a_".repeat(n / 2)],
    ["the EMV prefix and nothing else", (n: number) => `000201${"a".repeat(n)}`],
    ["a scheme with no credential", (n: number) => `bearer ${"a".repeat(n)}`],
  ] as const;

  test("does not grow with the length of the input", () => {
    for (const [label, build] of NEARLY_MATCHING) {
      const start = performance.now();
      sanitize(build(200_000));
      const elapsed = performance.now() - start;
      /*
       * Generously above the ~1ms this actually takes, and far below the
       * seconds the unbounded patterns took: a threshold that only fails when
       * the shape of the cost has changed, not when the machine is busy.
       */
      expect(elapsed, `${label} took ${elapsed.toFixed(0)}ms`).toBeLessThan(250);
    }
  });

  test("still redacts everything it is for", () => {
    // The cheap way to pass the test above is to stop matching. Each of these
    // is a thing that reached a log before the redaction existed.
    expect(sanitize("erro para ana.silva@example.com no pedido")).toBe(
      "erro para [email] no pedido",
    );
    expect(sanitize("Authorization: Basic dXNlcjpwYXNzd29yZA==")).toBe(
      "Authorization: Basic [redacted]",
    );
    expect(sanitize("MERCADO_PAGO_ACCESS_TOKEN=APP_USR-abc.def-123")).toBe("[redacted]");
    expect(sanitize("cole isto: 00020126580014br.gov.bcb.pix0136abc6304ABCD")).toBe(
      "cole isto: [pix-payload]",
    );
    expect(sanitize("chave sk_live_abcdef123456 usada")).toBe("chave [key] usada");
  });

  test("redacts a secret that begins inside the part it prints", () => {
    /*
     * The risk the scan cap introduces. Everything past the cap is dropped, so
     * it cannot be printed — but a match that *starts* just inside the printed
     * region must still be seen whole, or half an address would be printed and
     * the other half merely truncated.
     */
    const padded = `${"x".repeat(190)} ana.silva@example.com resto`;
    const cleaned = sanitize(padded);
    expect(cleaned).toContain("[email]");
    expect(cleaned).not.toContain("ana.silva");
    expect(cleaned).not.toContain("ana.sil");
  });
});
