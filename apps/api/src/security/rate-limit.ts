/**
 * A fixed-window in-process rate limiter.
 *
 * V1 runs a single API replica, so an in-process limiter is honest and cheap.
 * It is deliberately not a security boundary on its own: it throttles abuse of
 * write-heavy public endpoints while server-side authorization does the real
 * work. Before horizontal scaling this moves to shared infrastructure; Redis is
 * not introduced merely because it might one day be useful.
 */
export type RateLimitRule = {
  readonly limit: number;
  readonly windowMs: number;
};

export type RateLimitDecision = {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
};

type Bucket = { count: number; resetAt: number };

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  constructor(private readonly now: () => number = Date.now) {}

  check(key: string, rule: RateLimitRule): RateLimitDecision {
    const currentTime = this.now();
    this.sweep(currentTime);

    const existing = this.buckets.get(key);
    if (existing === undefined || existing.resetAt <= currentTime) {
      this.buckets.set(key, { count: 1, resetAt: currentTime + rule.windowMs });
      return { allowed: true, remaining: rule.limit - 1, retryAfterSeconds: 0 };
    }

    if (existing.count >= rule.limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - currentTime) / 1000)),
      };
    }

    existing.count += 1;
    return { allowed: true, remaining: rule.limit - existing.count, retryAfterSeconds: 0 };
  }

  reset(): void {
    this.buckets.clear();
  }

  /** Drops expired buckets so a long-running process does not grow unbounded. */
  private sweep(currentTime: number): void {
    if (currentTime - this.lastSweep < 60_000) {
      return;
    }
    this.lastSweep = currentTime;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= currentTime) {
        this.buckets.delete(key);
      }
    }
  }
}

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export type RateLimitScope =
  | "creatorSubmission"
  | "report"
  | "optOutRequest"
  | "optOutVerify"
  | "boostCreation"
  | "analyticsIngest";

export type RateLimitRules = Readonly<Record<RateLimitScope, RateLimitRule>>;

/**
 * Limits for the write-heavy public surfaces, taken from configuration so a
 * deployment can tune them without the code ever disabling them.
 */
export function rateLimitRules(product: {
  readonly submissionsPerHour: number;
  readonly reportsPerHour: number;
  readonly optOutRequestsPerHour: number;
  readonly optOutVerificationsPerHour: number;
  readonly boostsPerHour: number;
  readonly impressionsPerMinute: number;
}): RateLimitRules {
  return {
    creatorSubmission: { limit: product.submissionsPerHour, windowMs: HOUR_MS },
    report: { limit: product.reportsPerHour, windowMs: HOUR_MS },
    optOutRequest: { limit: product.optOutRequestsPerHour, windowMs: HOUR_MS },
    optOutVerify: { limit: product.optOutVerificationsPerHour, windowMs: HOUR_MS },
    boostCreation: { limit: product.boostsPerHour, windowMs: HOUR_MS },
    analyticsIngest: { limit: product.impressionsPerMinute, windowMs: MINUTE_MS },
  };
}

/**
 * The client identity a limit is keyed on.
 *
 * Writes reach the API through the web server, so without a forwarded address
 * every visitor on the planet would share one bucket and a single enthusiastic
 * user could throttle everybody. The first hop in `x-forwarded-for` is used when
 * present. This is a throttling key, not an authentication claim, and it is
 * never treated as one.
 */
export function clientKey(request: Request, fallback = "unknown"): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first !== undefined && first !== "") {
    return first;
  }
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? fallback;
}
