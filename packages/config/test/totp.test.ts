import { describe, expect, test } from "bun:test";
import {
  decodeBase32,
  encodeBase32,
  generateTotpSecret,
  totpCodeAt,
  totpUri,
  verifyTotp,
} from "../src/totp";

const STEP_MS = 30_000;

describe("base32", () => {
  test("round-trips arbitrary bytes", () => {
    for (let length = 0; length <= 32; length += 1) {
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) {
        bytes[index] = (index * 37 + 11) % 256;
      }
      expect(Array.from(decodeBase32(encodeBase32(bytes)))).toEqual(Array.from(bytes));
    }
  });

  test("uses only the RFC 4648 alphabet, without padding", () => {
    const encoded = encodeBase32(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(encoded).toMatch(/^[A-Z2-7]+$/);
  });

  test("accepts lowercase and spaced input, because people retype it", () => {
    const bytes = new Uint8Array([12, 34, 56, 78, 90]);
    const encoded = encodeBase32(bytes);
    const retyped = `${encoded.slice(0, 4).toLowerCase()} ${encoded.slice(4)}`;
    expect(Array.from(decodeBase32(retyped))).toEqual(Array.from(bytes));
  });

  test("rejects a character outside the alphabet", () => {
    expect(() => decodeBase32("ABCD1")).toThrow();
    expect(() => decodeBase32("ABCD!")).toThrow();
  });
});

describe("TOTP against the RFC 6238 reference vectors", () => {
  // RFC 6238 Appendix B, SHA-1, seed "12345678901234567890".
  const seed = encodeBase32(new TextEncoder().encode("12345678901234567890"));
  const vectors: ReadonlyArray<readonly [number, string]> = [
    [59, "287082"],
    [1_111_111_109, "081804"],
    [1_111_111_111, "050471"],
    [1_234_567_890, "005924"],
    [2_000_000_000, "279037"],
  ];

  for (const [seconds, expected] of vectors) {
    test(`t=${seconds} produces ${expected}`, () => {
      expect(totpCodeAt(seed, Math.floor(seconds / 30))).toBe(expected);
    });
  }
});

describe("TOTP verification", () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;
  const counter = Math.floor(now / STEP_MS);

  test("accepts the current code and reports which step matched", () => {
    expect(verifyTotp(secret, totpCodeAt(secret, counter), now)).toBe(counter);
  });

  test("accepts one step of clock drift in each direction", () => {
    expect(verifyTotp(secret, totpCodeAt(secret, counter - 1), now)).toBe(counter - 1);
    expect(verifyTotp(secret, totpCodeAt(secret, counter + 1), now)).toBe(counter + 1);
  });

  test("rejects a code two steps away", () => {
    expect(verifyTotp(secret, totpCodeAt(secret, counter - 2), now)).toBe(null);
    expect(verifyTotp(secret, totpCodeAt(secret, counter + 2), now)).toBe(null);
  });

  test("rejects a code for a different secret", () => {
    expect(verifyTotp(secret, totpCodeAt(generateTotpSecret(), counter), now)).toBe(null);
  });

  test("rejects anything that is not six digits", () => {
    expect(verifyTotp(secret, "", now)).toBe(null);
    expect(verifyTotp(secret, "12345", now)).toBe(null);
    expect(verifyTotp(secret, "1234567", now)).toBe(null);
    expect(verifyTotp(secret, "12345a", now)).toBe(null);
    expect(verifyTotp(secret, " 123456 ", now)).toBe(null);
  });

  test("rejects a malformed secret instead of throwing", () => {
    expect(verifyTotp("not base32!", "123456", now)).toBe(null);
    expect(verifyTotp("", "123456", now)).toBe(null);
  });

  test("a generated secret is 160 bits, the RFC 4226 recommendation", () => {
    expect(decodeBase32(generateTotpSecret()).length).toBe(20);
  });

  test("two generated secrets differ", () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});

describe("enrolment URI", () => {
  test("is an otpauth URI an authenticator app understands", () => {
    const secret = generateTotpSecret();
    const uri = new URL(totpUri({ secret, account: "edu", issuer: "Creator Outdoor" }));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(uri.pathname).toBe("/Creator%20Outdoor:edu");
    expect(uri.searchParams.get("secret")).toBe(secret);
    expect(uri.searchParams.get("issuer")).toBe("Creator Outdoor");
    expect(uri.searchParams.get("algorithm")).toBe("SHA1");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
  });
});
