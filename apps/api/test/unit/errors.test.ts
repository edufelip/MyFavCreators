import { describe, expect, test } from "bun:test";
import { describeError } from "../../src/observability/errors";

describe("describing an error for a log", () => {
  test("keeps the name and the message of an ordinary error", () => {
    expect(describeError(new TypeError("something broke"))).toEqual({
      name: "TypeError",
      message: "something broke",
    });
  });

  test("says nothing useful about a value that is not an error", () => {
    expect(describeError("boom")).toEqual({ name: "Unknown", message: "unknown" });
    expect(describeError(null)).toEqual({ name: "Unknown", message: "unknown" });
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
