import { describe, expect, test } from "bun:test";
import {
  deriveFanIdentityKey,
  fanIdentityKeysMatch,
  normalizeEmailForIdentity,
} from "../src/supporter";

const SECRET = "um-segredo-de-identidade-com-mais-de-32-bytes";

describe("email normalization", () => {
  test("folds case and trims", () => {
    expect(normalizeEmailForIdentity("  Marina@Exemplo.COM ")).toBe("marina@exemplo.com");
  });

  test("does not merge addresses a provider merely treats alike", () => {
    // Merging these would merge two people the platform has no right to merge.
    expect(normalizeEmailForIdentity("ma.rina@gmail.com")).not.toBe(
      normalizeEmailForIdentity("marina@gmail.com"),
    );
    expect(normalizeEmailForIdentity("marina+co@gmail.com")).not.toBe(
      normalizeEmailForIdentity("marina@gmail.com"),
    );
  });
});

describe("fan identity key", () => {
  test("is stable for the same email however it was typed", () => {
    const a = deriveFanIdentityKey({
      secret: SECRET,
      email: "Marina@Exemplo.com",
      supporterKey: "k1",
    });
    const b = deriveFanIdentityKey({
      secret: SECRET,
      email: " marina@exemplo.com ",
      supporterKey: "k2",
    });
    expect(a).toBe(b);
  });

  test("differs for different people", () => {
    const a = deriveFanIdentityKey({
      secret: SECRET,
      email: "marina@exemplo.com",
      supporterKey: "k",
    });
    const b = deriveFanIdentityKey({
      secret: SECRET,
      email: "caio@exemplo.com",
      supporterKey: "k",
    });
    expect(a).not.toBe(b);
  });

  test("falls back to the browser key when no email was given", () => {
    const withoutEmail = deriveFanIdentityKey({ secret: SECRET, supporterKey: "browser-key-1" });
    const sameBrowser = deriveFanIdentityKey({
      secret: SECRET,
      email: null,
      supporterKey: "browser-key-1",
    });
    const otherBrowser = deriveFanIdentityKey({ secret: SECRET, supporterKey: "browser-key-2" });
    expect(withoutEmail).toBe(sameBrowser);
    expect(withoutEmail).not.toBe(otherBrowser);
  });

  test("treats an empty email as no email", () => {
    expect(deriveFanIdentityKey({ secret: SECRET, email: "   ", supporterKey: "k" })).toBe(
      deriveFanIdentityKey({ secret: SECRET, supporterKey: "k" }),
    );
  });

  test("an email groups the same person across devices", () => {
    const phone = deriveFanIdentityKey({
      secret: SECRET,
      email: "marina@exemplo.com",
      supporterKey: "phone",
    });
    const laptop = deriveFanIdentityKey({
      secret: SECRET,
      email: "marina@exemplo.com",
      supporterKey: "laptop",
    });
    expect(phone).toBe(laptop);
  });

  test("a browser key can never collide with an email hash", () => {
    // The inputs are domain-separated, so a supporterKey that looks like an
    // email still hashes into a different space.
    expect(deriveFanIdentityKey({ secret: SECRET, supporterKey: "marina@exemplo.com" })).not.toBe(
      deriveFanIdentityKey({ secret: SECRET, email: "marina@exemplo.com", supporterKey: "x" }),
    );
  });

  test("is not a plain hash of the email: the secret changes everything", () => {
    const a = deriveFanIdentityKey({
      secret: SECRET,
      email: "marina@exemplo.com",
      supporterKey: "k",
    });
    const b = deriveFanIdentityKey({
      secret: "outro-segredo-de-identidade-com-32-bytes-ok",
      email: "marina@exemplo.com",
      supporterKey: "k",
    });
    expect(a).not.toBe(b);
  });

  test("never contains the email or the browser key", () => {
    const key = deriveFanIdentityKey({
      secret: SECRET,
      email: "marina@exemplo.com",
      supporterKey: "browser-key",
    });
    expect(key.includes("marina")).toBe(false);
    expect(key.includes("exemplo")).toBe(false);
    expect(key.includes("browser-key")).toBe(false);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  test("refuses a weak secret rather than producing a guessable key", () => {
    expect(() => deriveFanIdentityKey({ secret: "curto", supporterKey: "k" })).toThrow(RangeError);
  });
});

describe("key comparison", () => {
  test("matches equal keys and rejects everything else", () => {
    const key = deriveFanIdentityKey({ secret: SECRET, supporterKey: "k" });
    expect(fanIdentityKeysMatch(key, key)).toBe(true);
    expect(fanIdentityKeysMatch(key, `${key}0`)).toBe(false);
    expect(fanIdentityKeysMatch(key, "")).toBe(false);
  });
});
