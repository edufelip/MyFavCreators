import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "../src/password";
import { createSessionToken, readSessionToken } from "../src/session";

describe("password hashing", () => {
  test("accepts the correct password", () => {
    const hash = hashPassword("creator-outdoor-dev");
    expect(verifyPassword("creator-outdoor-dev", hash)).toBe(true);
  });

  test("rejects a wrong password", () => {
    const hash = hashPassword("creator-outdoor-dev");
    expect(verifyPassword("creator-outdoor-de", hash)).toBe(false);
    expect(verifyPassword("Creator-Outdoor-Dev", hash)).toBe(false);
    expect(verifyPassword("", hash)).toBe(false);
  });

  test("never stores the password itself", () => {
    const hash = hashPassword("uma-senha-secreta");
    expect(hash.includes("uma-senha-secreta")).toBe(false);
    expect(hash.startsWith("scrypt:")).toBe(true);
  });

  test("salts every hash, so the same password hashes differently", () => {
    expect(hashPassword("mesma-senha")).not.toBe(hashPassword("mesma-senha"));
  });

  test("is safe to place in an environment file a shell will source", () => {
    // `$` would be expanded and `/` can end a value early; neither may appear.
    const hash = hashPassword("uma-senha-qualquer");
    expect(hash).toMatch(/^[A-Za-z0-9:_-]+$/);
    expect(hash.includes("$")).toBe(false);
    expect(hash.includes("/")).toBe(false);
  });

  test("normalizes unicode so an equivalent password still verifies", () => {
    const hash = hashPassword("senha-café");
    expect(verifyPassword("senha-café", hash)).toBe(true);
  });

  test("fails closed on a malformed or empty stored hash", () => {
    for (const malformed of [
      "",
      "not-a-hash",
      "scrypt:1:2:3",
      "bcrypt:1:2:3:a:b",
      "scrypt:x:y:z:a:b",
    ]) {
      expect(verifyPassword("qualquer", malformed), malformed).toBe(false);
    }
  });
});

describe("session token", () => {
  const SECRET = "um-segredo-de-sessao-com-mais-de-32-bytes";
  const session = { ttlSeconds: 3600, subject: "edu" } as const;

  test("round-trips a valid session", () => {
    const token = createSessionToken(SECRET, session, 1_000_000);
    const payload = readSessionToken(token, SECRET, 1_000_000);
    expect(payload?.expiresAt).toBe(1_000_000 + 3_600_000);
  });

  test("names the operator it was issued to", () => {
    const token = createSessionToken(SECRET, { ttlSeconds: 60, subject: "ana.silva" }, 1_000_000);
    expect(readSessionToken(token, SECRET, 1_000_000)?.subject).toBe("ana.silva");
  });

  test("rejects a token signed with another secret", () => {
    const token = createSessionToken(SECRET, session, 1_000_000);
    expect(readSessionToken(token, "outro-segredo-igualmente-longo-aqui", 1_000_000)).toBeNull();
  });

  test("rejects a tampered payload", () => {
    const token = createSessionToken(SECRET, session, 1_000_000);
    const [encoded, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ issuedAt: 0, expiresAt: 9_999_999_999_999, nonce: "x", subject: "edu" }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    expect(readSessionToken(`${forged}.${signature}`, SECRET, 1_000_000)).toBeNull();
    expect(readSessionToken(`${encoded}.AAAA`, SECRET, 1_000_000)).toBeNull();
  });

  test("cannot be re-pointed at another operator without the secret", () => {
    const token = createSessionToken(SECRET, { ttlSeconds: 60, subject: "estagiario" }, 1_000_000);
    const [, signature] = token.split(".");
    const escalated = Buffer.from(
      JSON.stringify({ issuedAt: 1_000_000, expiresAt: 1_060_000, nonce: "x", subject: "edu" }),
    ).toString("base64url");
    expect(readSessionToken(`${escalated}.${signature}`, SECRET, 1_000_000)).toBeNull();
  });

  test("rejects a session that names nobody, so an unnamed action is impossible", () => {
    for (const subject of ["", "Edu", "edu silva", "e"]) {
      const encoded = Buffer.from(
        JSON.stringify({ issuedAt: 1_000_000, expiresAt: 1_060_000, nonce: "x", subject }),
      ).toString("base64url");
      const signature = createSessionToken(SECRET, { ttlSeconds: 60, subject: "edu" }, 1_000_000);
      expect(
        readSessionToken(`${encoded}.${signature.split(".")[1]}`, SECRET, 1_000_000),
      ).toBeNull();
    }
  });

  test("expires", () => {
    const token = createSessionToken(SECRET, { ttlSeconds: 60, subject: "edu" }, 1_000_000);
    expect(readSessionToken(token, SECRET, 1_000_000 + 59_000)).not.toBeNull();
    expect(readSessionToken(token, SECRET, 1_000_000 + 60_001)).toBeNull();
  });

  test("issues a distinct token every time", () => {
    expect(createSessionToken(SECRET, session, 1_000_000)).not.toBe(
      createSessionToken(SECRET, session, 1_000_000),
    );
  });

  test("rejects garbage", () => {
    for (const invalid of ["", ".", "abc", "abc.def", "....."]) {
      expect(readSessionToken(invalid, SECRET, 1_000_000), invalid).toBeNull();
    }
  });

  test("carries no credential", () => {
    const token = createSessionToken(SECRET, session, 1_000_000);
    expect(token.includes(SECRET)).toBe(false);
    const decoded = Buffer.from(token.split(".")[0] ?? "", "base64").toString("utf8");
    expect(decoded.includes("password")).toBe(false);
    expect(Object.keys(JSON.parse(decoded)).sort()).toEqual([
      "expiresAt",
      "issuedAt",
      "nonce",
      "subject",
    ]);
  });
});
