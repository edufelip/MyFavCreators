import { describe, expect, test } from "bun:test";
import { describeError, sanitize } from "../src/sanitization";

describe("sanitizing text for logs", () => {
  test("redacts an email address", () => {
    expect(sanitize("error for ana.silva@example.com in request")).toBe(
      "error for [email] in request",
    );
  });

  test("redacts authorization bearer and basic tokens", () => {
    expect(sanitize("Authorization: Basic dXNlcjpwYXNzd29yZA==")).toBe(
      "Authorization: Basic [redacted]",
    );
    expect(sanitize("Authorization: Bearer my-secret-token-123")).toBe(
      "Authorization: Bearer [redacted]",
    );
  });

  test("redacts assignments ending in credential words", () => {
    expect(sanitize("MERCADO_PAGO_ACCESS_TOKEN=APP_USR-abc.def-123")).toBe("[redacted]");
    expect(sanitize('api_secret: "super-secret-password"')).toBe("[redacted]");
  });

  test("redacts PIX BR Code payloads", () => {
    const real =
      "cobranca 00020126360014br.gov.bcb.pix013611111111-2222-3333-4444-5555555555555204" +
      "00005303986540510.005802BR5925CREATOR OUTDOOR PAGAMENTO6009SAO PAULO" +
      "62290525abcdef0123456789abcdef0163043A2F pronto";
    expect(sanitize(real)).toBe("cobranca [pix-payload] pronto");

    const truncated = "note 00020126580014br.gov.bcb.pix0136abcdef-1234-5678-9012-abcdef5204 end";
    expect(sanitize(truncated)).toBe("note [pix-payload] end");
  });

  test("redacts API keys", () => {
    expect(sanitize("key sk_live_abcdef123456 used")).toBe("key [key] used");
    expect(sanitize("key pk_test_abcdef123456 used")).toBe("key [key] used");
  });

  test("strips database driver query parameters", () => {
    const query =
      'Failed query: insert into "creator_claims" values ($1, $2)\nparams: 65d89caf, ana@example.com';
    expect(sanitize(query)).toBe('Failed query: insert into "creator_claims" values ($1, $2)');
  });

  test("truncates long messages and collapses whitespace", () => {
    expect(sanitize("a   \n\n  b")).toBe("a b");
    const long = "x".repeat(300);
    const cleaned = sanitize(long);
    expect(cleaned.length).toBe(203); // 200 + '...'
    expect(cleaned.endsWith("...")).toBe(true);
  });
});

describe("describing errors", () => {
  test("extracts safe name and message for standard error", () => {
    expect(describeError(new Error("simple error"))).toEqual({
      name: "Error",
      message: "simple error",
      frames: expect.any(Array),
    });
  });

  test("handles non-Error objects gracefully", () => {
    expect(describeError("string error")).toEqual({
      name: "Unknown",
      message: "unknown",
      frames: [],
    });
    expect(describeError(null)).toEqual({
      name: "Unknown",
      message: "unknown",
      frames: [],
    });
  });

  test("unwraps error causes up to 5 levels", () => {
    const root = new Error("root error");
    root.name = "RootError";
    const wrapper = new Error("wrapper", { cause: root });
    const described = describeError(wrapper);
    expect(described.name).toBe("RootError");
    expect(described.message).toBe("root error");
  });
});
