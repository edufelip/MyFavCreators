import { describe, expect, test } from "bun:test";
import {
  CLAIM_TOKEN_LENGTH,
  CREATOR_BIO_MAX,
  createClaimToken,
  hashClaimToken,
  sanitizeCreatorBio,
} from "../src";

describe("a management token", () => {
  test("is long enough not to be guessed and URL-safe", () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const token = createClaimToken();
      expect(token.length).toBeGreaterThanOrEqual(CLAIM_TOKEN_LENGTH);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  test("is never repeated", () => {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 500; attempt += 1) {
      seen.add(createClaimToken());
    }
    expect(seen.size).toBe(500);
  });

  test("hashes to something that does not reveal it", () => {
    const token = createClaimToken();
    const hash = hashClaimToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });

  test("hashes the same token to the same value, and different ones apart", () => {
    const token = createClaimToken();
    expect(hashClaimToken(token)).toBe(hashClaimToken(token));
    expect(hashClaimToken(token)).not.toBe(hashClaimToken(createClaimToken()));
  });

  test("refuses to hash something too short to be a real token", () => {
    // A caller passing an empty string must not accidentally match a row.
    expect(() => hashClaimToken("")).toThrow();
    expect(() => hashClaimToken("short")).toThrow();
  });
});

describe("a creator bio", () => {
  test("keeps ordinary text as written", () => {
    expect(sanitizeCreatorBio("Faço música em Belo Horizonte.")).toBe(
      "Faço música em Belo Horizonte.",
    );
  });

  test("trims and collapses the whitespace people paste in", () => {
    expect(sanitizeCreatorBio("  linha um\n\n\n   linha dois   ")).toBe("linha um\nlinha dois");
  });

  test("removes control characters", () => {
    expect(sanitizeCreatorBio("ol\u0000\u0007a")).toBe("ola");
  });

  test("is null when nothing is left", () => {
    expect(sanitizeCreatorBio("   ")).toBeNull();
    expect(sanitizeCreatorBio(null)).toBeNull();
    expect(sanitizeCreatorBio(undefined)).toBeNull();
  });

  test("refuses text longer than the profile allows", () => {
    expect(() => sanitizeCreatorBio("a".repeat(CREATOR_BIO_MAX + 1))).toThrow();
  });

  test("accepts text exactly at the limit", () => {
    expect(sanitizeCreatorBio("a".repeat(CREATOR_BIO_MAX))).toHaveLength(CREATOR_BIO_MAX);
  });
});
