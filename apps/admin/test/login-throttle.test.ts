import { describe, expect, test } from "bun:test";
import { clearAttempts, isThrottled, recordFailedAttempt } from "../src/lib/login-throttle";

describe("login throttling", () => {
  test("allows a handful of mistakes before locking the window", () => {
    const key = "attempt-basic";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(isThrottled(key), `attempt ${attempt}`).toBe(false);
      recordFailedAttempt(key);
    }
    expect(isThrottled(key)).toBe(true);
    clearAttempts(key);
  });

  test("a successful sign-in clears the counter", () => {
    const key = "attempt-clear";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      recordFailedAttempt(key);
    }
    expect(isThrottled(key)).toBe(true);
    clearAttempts(key);
    expect(isThrottled(key)).toBe(false);
  });

  test("the window reopens after it expires", () => {
    const key = "attempt-window";
    const start = 1_000_000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      recordFailedAttempt(key, start);
    }
    expect(isThrottled(key, start)).toBe(true);
    expect(isThrottled(key, start + 10 * 60 * 1000 + 1)).toBe(false);
    clearAttempts(key);
  });

  test("clients are throttled independently", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      recordFailedAttempt("attacker");
    }
    expect(isThrottled("attacker")).toBe(true);
    expect(isThrottled("operator")).toBe(false);
    clearAttempts("attacker");
  });

  test("an unknown client is never throttled by default", () => {
    expect(isThrottled("never-seen-before")).toBe(false);
  });
});
