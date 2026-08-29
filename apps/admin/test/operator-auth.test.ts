import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type AdminOperator,
  decodeOperators,
  generateTotpSecret,
  hashPassword,
  totpCodeAt,
} from "@creator-outdoor/config";
import {
  authenticateOperator,
  type LoginAttempt,
  type LoginOutcome,
  resetOperatorAuthState,
} from "../src/lib/operator-auth";

const NOW = 1_700_000_000_000;
const STEP = Math.floor(NOW / 30_000);

const eduSecret = generateTotpSecret();
const anaSecret = generateTotpSecret();

const OPERATORS: readonly AdminOperator[] = [
  { id: "edu", passwordHash: hashPassword("senha-do-edu"), totpSecret: eduSecret },
  { id: "ana.silva", passwordHash: hashPassword("senha-da-ana"), totpSecret: anaSecret },
];

/**
 * A sign-in outside production, which is what every rule below is about.
 *
 * The environment only decides one thing — whether the credentials published in
 * this repository are accepted — and the two tests that care about it call
 * `authenticateOperator` directly.
 */
function auth(
  operators: readonly AdminOperator[],
  attempt: LoginAttempt,
  now: number,
): LoginOutcome {
  return authenticateOperator(operators, attempt, { isProduction: false, now });
}

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
    expect(auth(OPERATORS, attempt(), NOW)).toEqual({
      kind: "OK",
      operator: "edu",
    });
  });

  test("refuses a correct password without the second factor", () => {
    expect(auth(OPERATORS, attempt({ code: "" }), NOW).kind).toBe("INVALID");
    expect(auth(OPERATORS, attempt({ code: "000000" }), NOW).kind).toBe("INVALID");
  });

  test("refuses a correct second factor without the password", () => {
    expect(auth(OPERATORS, attempt({ password: "chute" }), NOW).kind).toBe("INVALID");
  });

  test("refuses another operator's second factor", () => {
    const borrowed = totpCodeAt(anaSecret, STEP);
    expect(auth(OPERATORS, attempt({ code: borrowed }), NOW).kind).toBe("INVALID");
  });

  test("refuses another operator's password", () => {
    expect(auth(OPERATORS, attempt({ password: "senha-da-ana" }), NOW).kind).toBe("INVALID");
  });

  test("refuses an unknown operator, with the same answer as a wrong password", () => {
    expect(auth(OPERATORS, attempt({ operator: "ninguem" }), NOW)).toEqual({
      kind: "INVALID",
    });
  });

  test("refuses a malformed operator name without consulting the registry", () => {
    for (const operator of ["", "EDU", "edu silva", "e"]) {
      expect(auth(OPERATORS, attempt({ operator }), NOW).kind, operator).toBe("INVALID");
    }
  });

  test("accepts a code one step stale, because clocks drift", () => {
    const stale = totpCodeAt(eduSecret, STEP - 1);
    expect(auth(OPERATORS, attempt({ code: stale }), NOW).kind).toBe("OK");
  });
});

describe("replay", () => {
  test("the same code cannot be used twice", () => {
    const code = totpCodeAt(eduSecret, STEP);
    expect(auth(OPERATORS, attempt({ code }), NOW).kind).toBe("OK");
    expect(auth(OPERATORS, attempt({ code }), NOW + 1_000).kind).toBe("INVALID");
  });

  test("one operator's spent code does not spend another's", () => {
    const shared = STEP;
    expect(auth(OPERATORS, attempt(), NOW).kind).toBe("OK");
    expect(
      auth(
        OPERATORS,
        { operator: "ana.silva", password: "senha-da-ana", code: totpCodeAt(anaSecret, shared) },
        NOW,
      ).kind,
    ).toBe("OK");
  });

  test("the next window's code still works", () => {
    expect(auth(OPERATORS, attempt(), NOW).kind).toBe("OK");
    const later = NOW + 30_000;
    const next = totpCodeAt(eduSecret, Math.floor(later / 30_000));
    expect(auth(OPERATORS, attempt({ code: next }), later).kind).toBe("OK");
  });
});

describe("the credentials published in this repository", () => {
  /*
   * `.env.example` ships a working operator so the admin app runs the moment
   * somebody clones this repository. Its password and TOTP seed are therefore
   * public, and in production that is an account anybody on the internet can
   * use to approve creators and issue refunds.
   *
   * Read from the file rather than pasted here, because a copy would keep
   * passing after somebody rotated the real one — a guard that agrees with
   * nothing is a guard that protects nothing.
   */
  const published = decodeOperators(
    (
      readFileSync(new URL("../../../.env.example", import.meta.url), "utf8")
        .split("\n")
        .find((line) => line.startsWith("ADMIN_OPERATORS=")) ?? ""
    )
      .split("=")
      .slice(1)
      .join("="),
  );
  const publishedAttempt: LoginAttempt = {
    // The password `.env.example` documents beside the registry.
    operator: "edu",
    password: "creator-outdoor-dev",
    code: totpCodeAt(published[0]?.totpSecret ?? "", STEP),
  };

  test("the example registry really does hold working credentials", () => {
    // Otherwise every assertion below would pass for the wrong reason: a
    // password that fails anyway is refused by the ordinary check, and this
    // whole rule could be deleted without a test noticing.
    expect(published).toHaveLength(1);
    expect(auth(published, publishedAttempt, NOW).kind).toBe("OK");
  });

  test("are refused in production, by name, so the operator knows why", () => {
    expect(
      authenticateOperator(published, publishedAttempt, { isProduction: true, now: NOW }),
    ).toEqual({ kind: "PUBLISHED_CREDENTIALS" });
  });

  test("do not take down an operator who was enrolled properly", () => {
    /*
     * The reason this refusal lives here rather than in `parseAdminConfig`.
     * Refusing at parse time is all-or-nothing: a deployment that enrolled a
     * real operator and left the example entry behind lost its entire admin
     * app over an account that, with this check, grants nothing.
     */
    const mixed: readonly AdminOperator[] = [...published, ...OPERATORS.slice(1)];
    expect(
      authenticateOperator(
        mixed,
        { operator: "ana.silva", password: "senha-da-ana", code: totpCodeAt(anaSecret, STEP) },
        { isProduction: true, now: NOW },
      ).kind,
    ).toBe("OK");
  });

  test("are still refused for the ordinary reason when the password is wrong", () => {
    // The message names the published credentials, so it must never be shown
    // to somebody who did not present them: that would tell an unauthenticated
    // caller which accounts exist and which are unusable.
    expect(
      authenticateOperator(
        published,
        { ...publishedAttempt, password: "chute" },
        { isProduction: true, now: NOW },
      ).kind,
    ).toBe("INVALID");
  });

  test("are accepted outside production, or nobody could run this locally", () => {
    expect(auth(published, publishedAttempt, NOW).kind).toBe("OK");
  });
});

describe("throttling", () => {
  test("locks the operator after five failures, whoever is asking", () => {
    for (let tries = 0; tries < 5; tries += 1) {
      expect(auth(OPERATORS, attempt({ password: "chute" }), NOW).kind).toBe("INVALID");
    }
    expect(auth(OPERATORS, attempt({ password: "chute" }), NOW).kind).toBe("THROTTLED");
  });

  test("refuses even the correct credentials while locked", () => {
    for (let tries = 0; tries < 5; tries += 1) {
      auth(OPERATORS, attempt({ password: "chute" }), NOW);
    }
    expect(auth(OPERATORS, attempt(), NOW).kind).toBe("THROTTLED");
  });

  test("every malformed name shares one budget, so the map cannot be grown", () => {
    /*
     * The key used to be built from the submitted name, so one unauthenticated
     * POST could store a megabyte-long entry — and nothing ever removed it. No
     * name in this bucket can authenticate, so there is nothing to tell apart.
     */
    for (let tries = 0; tries < 5; tries += 1) {
      auth(OPERATORS, attempt({ operator: `LIXO-${tries}-${"x".repeat(64)}` }), NOW);
    }
    expect(auth(OPERATORS, attempt({ operator: "OUTRO LIXO" }), NOW).kind).toBe("THROTTLED");
    // A real operator is unaffected by whatever was thrown at that bucket.
    expect(auth(OPERATORS, attempt(), NOW).kind).toBe("OK");
  });

  test("forgets a window that has closed, rather than keeping it forever", () => {
    for (let tries = 0; tries < 5; tries += 1) {
      auth(OPERATORS, attempt({ operator: "ninguem", password: "x" }), NOW);
    }
    const later = NOW + 10 * 60 * 1000 + 1;
    // A failure after the window makes a fresh budget rather than resuming one.
    auth(OPERATORS, attempt({ operator: "ninguem", password: "x" }), later);
    expect(auth(OPERATORS, attempt({ operator: "ninguem" }), later).kind).toBe("INVALID");
  });

  test("throttles an unknown name too, so names cannot be enumerated", () => {
    for (let tries = 0; tries < 5; tries += 1) {
      auth(OPERATORS, attempt({ operator: "ninguem" }), NOW);
    }
    expect(auth(OPERATORS, attempt({ operator: "ninguem" }), NOW).kind).toBe("THROTTLED");
  });

  test("locking one operator leaves the others able to work", () => {
    for (let tries = 0; tries < 6; tries += 1) {
      auth(OPERATORS, attempt({ password: "chute" }), NOW);
    }
    expect(
      auth(
        OPERATORS,
        { operator: "ana.silva", password: "senha-da-ana", code: totpCodeAt(anaSecret, STEP) },
        NOW,
      ).kind,
    ).toBe("OK");
  });

  test("a success clears the counter", () => {
    for (let tries = 0; tries < 4; tries += 1) {
      auth(OPERATORS, attempt({ password: "chute" }), NOW);
    }
    expect(auth(OPERATORS, attempt(), NOW).kind).toBe("OK");
    for (let tries = 0; tries < 5; tries += 1) {
      expect(auth(OPERATORS, attempt({ password: "chute" }), NOW).kind).toBe("INVALID");
    }
  });

  test("the window reopens", () => {
    for (let tries = 0; tries < 6; tries += 1) {
      auth(OPERATORS, attempt({ password: "chute" }), NOW);
    }
    const later = NOW + 10 * 60 * 1000 + 1;
    const code = totpCodeAt(eduSecret, Math.floor(later / 30_000));
    expect(auth(OPERATORS, attempt({ code }), later).kind).toBe("OK");
  });
});
