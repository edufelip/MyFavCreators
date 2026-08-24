import { describe, expect, test } from "bun:test";
import { PRODUCT_DEFAULTS } from "@creator-outdoor/config";
import {
  ADMIN_SECRET_HEADER,
  isAuthorizedAdminRequest,
  secretsMatch,
} from "../../src/security/admin-auth";
import { clientKey, RateLimiter, rateLimitRules } from "../../src/security/rate-limit";

describe("admin secret comparison", () => {
  test("accepts an exact match and rejects everything else", () => {
    expect(secretsMatch("segredo-do-admin", "segredo-do-admin")).toBe(true);
    expect(secretsMatch("segredo-do-admi", "segredo-do-admin")).toBe(false);
    expect(secretsMatch("segredo-do-adminx", "segredo-do-admin")).toBe(false);
    expect(secretsMatch("SEGREDO-DO-ADMIN", "segredo-do-admin")).toBe(false);
    expect(secretsMatch("", "segredo-do-admin")).toBe(false);
  });

  test("does not throw when the lengths differ", () => {
    expect(() => secretsMatch("a", "muito-mais-longo")).not.toThrow();
  });

  test("authorizes only a request carrying the header", () => {
    const secret = "segredo-do-admin";
    const withHeader = new Request("http://localhost/internal/admin/creators", {
      headers: { [ADMIN_SECRET_HEADER]: secret },
    });
    const without = new Request("http://localhost/internal/admin/creators");
    expect(isAuthorizedAdminRequest(withHeader, secret)).toBe(true);
    expect(isAuthorizedAdminRequest(without, secret)).toBe(false);
  });

  test("fails closed when no secret is configured", () => {
    const request = new Request("http://localhost/internal/admin/creators", {
      headers: { [ADMIN_SECRET_HEADER]: "" },
    });
    expect(isAuthorizedAdminRequest(request, "")).toBe(false);
  });
});

describe("rate limiter", () => {
  test("allows up to the limit then refuses", () => {
    const now = 0;
    const limiter = new RateLimiter(() => now);
    const rule = { limit: 3, windowMs: 1000 };
    expect(limiter.check("a", rule).allowed).toBe(true);
    expect(limiter.check("a", rule).allowed).toBe(true);
    expect(limiter.check("a", rule).allowed).toBe(true);
    const refused = limiter.check("a", rule);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("keys are independent", () => {
    const now = 0;
    const limiter = new RateLimiter(() => now);
    const rule = { limit: 1, windowMs: 1000 };
    expect(limiter.check("a", rule).allowed).toBe(true);
    expect(limiter.check("b", rule).allowed).toBe(true);
    expect(limiter.check("a", rule).allowed).toBe(false);
  });

  test("the window reopens", () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    const rule = { limit: 1, windowMs: 1000 };
    expect(limiter.check("a", rule).allowed).toBe(true);
    expect(limiter.check("a", rule).allowed).toBe(false);
    now = 1001;
    expect(limiter.check("a", rule).allowed).toBe(true);
  });

  test("reports the remaining budget", () => {
    const limiter = new RateLimiter(() => 0);
    const rule = { limit: 3, windowMs: 1000 };
    expect(limiter.check("a", rule).remaining).toBe(2);
    expect(limiter.check("a", rule).remaining).toBe(1);
    expect(limiter.check("a", rule).remaining).toBe(0);
  });

  test("every write-heavy public surface has a limit", () => {
    const rules = rateLimitRules(PRODUCT_DEFAULTS);
    for (const scope of [
      "creatorSubmission",
      "report",
      "optOutRequest",
      "optOutVerify",
      "boostCreation",
      "analyticsIngest",
    ] as const) {
      expect(rules[scope].limit, scope).toBeGreaterThan(0);
      expect(rules[scope].windowMs, scope).toBeGreaterThan(0);
    }
  });

  test("uses the documented defaults and honours configuration", () => {
    const defaults = rateLimitRules(PRODUCT_DEFAULTS);
    expect(defaults.creatorSubmission.limit).toBe(5);
    expect(defaults.creatorSubmission.windowMs).toBe(3_600_000);
    expect(defaults.analyticsIngest.windowMs).toBe(60_000);

    const relaxed = rateLimitRules({ ...PRODUCT_DEFAULTS, submissionsPerHour: 500 });
    expect(relaxed.creatorSubmission.limit).toBe(500);
  });
});

describe("client key", () => {
  test("prefers the first forwarded hop", () => {
    const request = new Request("http://localhost/", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientKey(request)).toBe("203.0.113.7");
  });

  test("falls back through the other proxy headers", () => {
    expect(
      clientKey(new Request("http://localhost/", { headers: { "x-real-ip": "203.0.113.9" } })),
    ).toBe("203.0.113.9");
    expect(clientKey(new Request("http://localhost/"), "anon")).toBe("anon");
  });
});
