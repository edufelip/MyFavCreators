import { describe, expect, test } from "bun:test";
import {
  type AdminOperator,
  decodeOperators,
  encodeOperators,
  findOperator,
  isOperatorId,
} from "../src/operators";
import { hashPassword } from "../src/password";
import { generateTotpSecret } from "../src/totp";

function operator(id: string): AdminOperator {
  return { id, passwordHash: hashPassword(`${id}-senha`), totpSecret: generateTotpSecret() };
}

describe("operator identifiers", () => {
  test("accepts the shapes a person would actually pick", () => {
    for (const id of ["edu", "ana.silva", "ops-2", "moderador_1", "a1"]) {
      expect(isOperatorId(id)).toBe(true);
    }
  });

  test("rejects anything that would blur one operator into another", () => {
    for (const id of [
      "",
      "a",
      "Edu",
      "edu ",
      " edu",
      "edu silva",
      ".edu",
      "-edu",
      "e".repeat(33),
    ]) {
      expect(isOperatorId(id)).toBe(false);
    }
  });
});

describe("encoding the operator registry", () => {
  test("round-trips", () => {
    const operators = [operator("edu"), operator("ana.silva")];
    expect(decodeOperators(encodeOperators(operators))).toEqual(operators);
  });

  test("is shell-safe, because it lives in a file people source", () => {
    expect(encodeOperators([operator("edu")])).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("never contains a password", () => {
    const encoded = encodeOperators([
      {
        id: "edu",
        passwordHash: hashPassword("uma-senha-secreta"),
        totpSecret: generateTotpSecret(),
      },
    ]);
    expect(Buffer.from(encoded, "base64url").toString("utf8")).not.toContain("uma-senha-secreta");
  });

  test("rejects an empty registry, so a deployment cannot lose its operators quietly", () => {
    expect(() => decodeOperators(encodeOperators([]))).toThrow();
  });

  test("rejects a duplicate identifier, which would make the audit log ambiguous", () => {
    const duplicated = [operator("edu"), { ...operator("edu"), id: "edu" }];
    expect(() => decodeOperators(encodeOperators(duplicated))).toThrow();
  });

  test("rejects a malformed identifier", () => {
    const encoded = Buffer.from(
      JSON.stringify([
        { id: "Edu", passwordHash: hashPassword("x"), totpSecret: generateTotpSecret() },
      ]),
      "utf8",
    ).toString("base64url");
    expect(() => decodeOperators(encoded)).toThrow();
  });

  test("rejects an entry with no second factor", () => {
    const encoded = Buffer.from(
      JSON.stringify([{ id: "edu", passwordHash: hashPassword("x"), totpSecret: "" }]),
      "utf8",
    ).toString("base64url");
    expect(() => decodeOperators(encoded)).toThrow();
  });

  test("rejects a second factor that is not decodable base32", () => {
    const encoded = Buffer.from(
      JSON.stringify([{ id: "edu", passwordHash: hashPassword("x"), totpSecret: "not base32!!" }]),
      "utf8",
    ).toString("base64url");
    expect(() => decodeOperators(encoded)).toThrow();
  });

  test("rejects a second factor with too little entropy", () => {
    const encoded = Buffer.from(
      JSON.stringify([{ id: "edu", passwordHash: hashPassword("x"), totpSecret: "AAAAAAAA" }]),
      "utf8",
    ).toString("base64url");
    expect(() => decodeOperators(encoded)).toThrow();
  });

  test("rejects text that is not the registry at all", () => {
    expect(() => decodeOperators("")).toThrow();
    expect(() => decodeOperators("not-base64url-json")).toThrow();
    expect(() =>
      decodeOperators(Buffer.from('{"id":"edu"}', "utf8").toString("base64url")),
    ).toThrow();
  });
});

describe("looking an operator up", () => {
  const operators = [operator("edu"), operator("ana.silva")];

  test("finds one by identifier", () => {
    expect(findOperator(operators, "ana.silva")?.id).toBe("ana.silva");
  });

  test("does not find one by a differently-cased identifier", () => {
    expect(findOperator(operators, "Ana.Silva")).toBe(null);
  });

  test("returns null for an unknown identifier rather than a default operator", () => {
    expect(findOperator(operators, "ninguem")).toBe(null);
    expect(findOperator(operators, "")).toBe(null);
  });
});
