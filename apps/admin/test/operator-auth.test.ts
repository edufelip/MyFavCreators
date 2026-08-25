import { beforeEach, describe, expect, test } from "bun:test";
import {
  type AdminOperator,
  generateTotpSecret,
  hashPassword,
  totpCodeAt,
} from "@creator-outdoor/config";
import { authenticateOperator, resetOperatorAuthState } from "../src/lib/operator-auth";

const NOW = 1_700_000_000_000;
const STEP = Math.floor(NOW / 30_000);

const eduSecret = generateTotpSecret();
const anaSecret = generateTotpSecret();

const OPERATORS: readonly AdminOperator[] = [
  { id: "edu", passwordHash: hashPassword("senha-do-edu"), totpSecret: eduSecret },
  { id: "ana.silva", passwordHash: hashPassword("senha-da-ana"), totpSecret: anaSecret },
];

function attempt(overrides: Partial<{ operator: string; password: string; code: string }> = {}) {
  return {
    operator: "edu",
    password: "senha-do-edu",
    code: totpCodeAt(eduSecret, STEP),
    ...overrides,
  };
}

beforeEach(() => {
  resetOperatorAuthState();
});

describe("signing an operator in", () => {
  test("accepts the right name, password and code together", () => {
    expect(authenticateOperator(OPERATORS, attempt(), NOW)).toEqual({
      kind: "OK",
      operator: "edu",
    });
  });

  test("refuses a correct password without the second factor", () => {
    expect(authenticateOperator(OPERATORS, attempt({ code: "" }), NOW).kind).toBe("INVALID");
    expect(authenticateOperator(OPERATORS, attempt({ code: "000000" }), NOW).kind).toBe("INVALID");
  });

  test("refuses a correct second factor without the password", () => {
    expect(authenticateOperator(OPERATORS, attempt({ password: "chute" }), NOW).kind).toBe(
      "INVALID",
    );
  });

  test("refuses another operator's second factor", () => {
    const borrowed = totpCodeAt(anaSecret, STEP);
    expect(authenticateOperator(OPERATORS, attempt({ code: borrowed }), NOW).kind).toBe("INVALID");
  });

  test("refuses another operator's password", () => {
    expect(authenticateOperator(OPERATORS, attempt({ password: "senha-da-ana" }), NOW).kind).toBe(
      "INVALID",
    );
  });

  test("refuses an unknown operator, with the same answer as a wrong password", () => {
    expect(authenticateOperator(OPERATORS, attempt({ operator: "ninguem" }), NOW)).toEqual({
      kind: "INVALID",
    });
  });

  test("refuses a malformed operator name without consulting the registry", () => {
    for (const operator of ["", "EDU", "edu silva", "e"]) {
      expect(authenticateOperator(OPERATORS, attempt({ operator }), NOW).kind, operator).toBe(
        "INVALID",
      );
    }
  });

  test("accepts a code one step stale, because clocks drift", () => {
    const stale = totpCodeAt(eduSecret, STEP - 1);
    expect(authenticateOperator(OPERATORS, attempt({ code: stale }), NOW).kind).toBe("OK");
  });
});

describe("replay", () => {
  test("the same code cannot be used twice", () => {
    const code = totpCodeAt(eduSecret, STEP);
    expect(authenticateOperator(OPERATORS, attempt({ code }), NOW).kind).toBe("OK");
    expect(authenticateOperator(OPERATORS, attempt({ code }), NOW + 1_000).kind).toBe("INVALID");
  });

  test("one operator's spent code does not spend another's", () => {
    const shared = STEP;
    expect(authenticateOperator(OPERATORS, attempt(), NOW).kind).toBe("OK");
    expect(
      authenticateOperator(
        OPERATORS,
        { operator: "ana.silva", password: "senha-da-ana", code: totpCodeAt(anaSecret, shared) },
        NOW,
      ).kind,
    ).toBe("OK");
  });

  test("the next window's code still works", () => {
    expect(authenticateOperator(OPERATORS, attempt(), NOW).kind).toBe("OK");
    const later = NOW + 30_000;
    const next = totpCodeAt(eduSecret, Math.floor(later / 30_000));
    expect(authenticateOperator(OPERATORS, attempt({ code: next }), later).kind).toBe("OK");
  });
});

describe("throttling", () => {
  test("locks the operator after five failures, whoever is asking", () => {
    for (let tries = 0; tries < 5; tries += 1) {
      expect(authenticateOperator(OPERATORS, attempt({ password: "chute" }), NOW).kind).toBe(
        "INVALID",
      );
    }
    expect(authenticateOperator(OPERATORS, attempt({ password: "chute" }), NOW).kind).toBe(
      "THROTTLED",
    );
  });

  test("refuses even the correct credentials while locked", () => {
    for (let tries = 0; tries < 5; tries += 1) {
      authenticateOperator(OPERATORS, attempt({ password: "chute" }), NOW);
    }
    expect(authenticateOperator(OPERATORS, attempt(), NOW).kind).toBe("THROTTLED");
  });

  test("throttles an unknown name too, so names cannot be enumerated", () => {
    for (let tries = 0; tries < 5; tries += 1) {
      authenticateOperator(OPERATORS, attempt({ operator: "ninguem" }), NOW);
    }
    expect(authenticateOperator(OPERATORS, attempt({ operator: "ninguem" }), NOW).kind).toBe(
      "THROTTLED",
    );
  });

  test("locking one operator leaves the others able to work", () => {
    for (let tries = 0; tries < 6; tries += 1) {
      authenticateOperator(OPERATORS, attempt({ password: "chute" }), NOW);
    }
    expect(
      authenticateOperator(
        OPERATORS,
        { operator: "ana.silva", password: "senha-da-ana", code: totpCodeAt(anaSecret, STEP) },
        NOW,
      ).kind,
    ).toBe("OK");
  });

  test("a success clears the counter", () => {
    for (let tries = 0; tries < 4; tries += 1) {
      authenticateOperator(OPERATORS, attempt({ password: "chute" }), NOW);
    }
    expect(authenticateOperator(OPERATORS, attempt(), NOW).kind).toBe("OK");
    for (let tries = 0; tries < 5; tries += 1) {
      expect(authenticateOperator(OPERATORS, attempt({ password: "chute" }), NOW).kind).toBe(
        "INVALID",
      );
    }
  });

  test("the window reopens", () => {
    for (let tries = 0; tries < 6; tries += 1) {
      authenticateOperator(OPERATORS, attempt({ password: "chute" }), NOW);
    }
    const later = NOW + 10 * 60 * 1000 + 1;
    const code = totpCodeAt(eduSecret, Math.floor(later / 30_000));
    expect(authenticateOperator(OPERATORS, attempt({ code }), later).kind).toBe("OK");
  });
});
