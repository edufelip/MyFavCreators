import { describe, expect, test } from "bun:test";
import {
  createUnsubscribeToken,
  normalizeEmail,
  redactEmail,
  UNSUBSCRIBE_TOKEN_LENGTH,
} from "../src";

describe("normalizing an email", () => {
  test("lowercases and trims, so one person is one subscription", () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });

  test("refuses something that is not an address", () => {
    for (const invalid of ["", "   ", "ana", "ana@", "@example.com", "ana example.com"]) {
      expect(() => normalizeEmail(invalid), invalid).toThrow();
    }
  });

  test("refuses an address long enough to be an attack rather than an inbox", () => {
    expect(() => normalizeEmail(`${"a".repeat(250)}@example.com`)).toThrow();
  });

  test("keeps a plus tag, which is a different inbox to its owner", () => {
    expect(normalizeEmail("ana+outdoor@example.com")).toBe("ana+outdoor@example.com");
  });
});

describe("redacting an email for a log line", () => {
  test("keeps enough to correlate and not enough to identify", () => {
    expect(redactEmail("ana@example.com")).toBe("a***@example.com");
  });

  test("hides a single-character local part completely", () => {
    expect(redactEmail("a@example.com")).toBe("***@example.com");
  });

  test("never returns the address it was given", () => {
    for (const address of ["ana@example.com", "a@b.co", "muito.longo@dominio.com.br"]) {
      expect(redactEmail(address)).not.toBe(address);
      expect(redactEmail(address)).not.toContain(address.split("@")[0]);
    }
  });

  test("says nothing at all about a value that is not an address", () => {
    expect(redactEmail("not-an-address")).toBe("***");
  });
});

describe("unsubscribe tokens", () => {
  test("are long enough not to be guessed", () => {
    expect(createUnsubscribeToken().length).toBeGreaterThanOrEqual(UNSUBSCRIBE_TOKEN_LENGTH);
  });

  test("are URL-safe, because they travel in a link in an email", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(createUnsubscribeToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  test("are never repeated", () => {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 500; attempt += 1) {
      seen.add(createUnsubscribeToken());
    }
    expect(seen.size).toBe(500);
  });
});
