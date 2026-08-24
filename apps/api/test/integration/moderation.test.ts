import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PRODUCT_DEFAULTS } from "@creator-outdoor/config";
import {
  AdminCreatorListDto,
  CreatorDetailDto,
  CreatorSubmissionResponseDto,
  OptOutChallengeDto,
  OptOutVerificationResponseDto,
  parseContract,
} from "@creator-outdoor/contracts";
import {
  createTestDatabase,
  insertBoost,
  insertCategory,
  insertCreator,
  suppressKey,
  type TestDatabase,
} from "@creator-outdoor/testkit";
import { createApp } from "../../src/app";
import { RateLimiter } from "../../src/security/rate-limit";

const ADMIN_SECRET = "integration-admin-secret-value";
const NOW = new Date("2026-08-19T18:30:00.000Z");

const testDatabase: TestDatabase = await createTestDatabase();
const rateLimiter = new RateLimiter();
// Rate limits come from configuration; the suite pins the documented defaults
// so a relaxed development environment cannot mask a broken limiter.
const app = createApp({
  database: testDatabase.db,
  product: PRODUCT_DEFAULTS,
  allowedOrigins: ["http://localhost:3000"],
  adminApiSecret: ADMIN_SECRET,
  rateLimiter,
  now: () => NOW,
});

beforeEach(async () => {
  await testDatabase.truncate();
  rateLimiter.reset();
  await insertCategory(testDatabase.db, { slug: "musica", name: "Música", isActive: true });
});

afterAll(async () => {
  await testDatabase.close();
});

async function call(path: string, init?: RequestInit): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`, init));
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return call(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const adminHeaders = { "x-admin-api-secret": ADMIN_SECRET };

async function submit(url: string) {
  const response = await post("/v1/creators/submissions", { url });
  return parseContract(
    CreatorSubmissionResponseDto,
    await response.json(),
    "CreatorSubmissionResponse",
  );
}

async function pendingQueue() {
  const response = await call("/internal/admin/creators?status=PENDING_REVIEW", {
    headers: adminHeaders,
  });
  return parseContract(AdminCreatorListDto, await response.json(), "AdminCreatorList");
}

describe("creator submission", () => {
  test("accepts a valid profile and keeps it out of public view", async () => {
    const result = await submit("https://instagram.com/novacriadora");
    expect(result.outcome).toBe("SUBMITTED");

    const queue = await pendingQueue();
    expect(queue.total).toBe(1);
    expect(queue.creators[0]?.moderationStatus).toBe("PENDING_REVIEW");

    // Not on the leaderboard and not reachable by slug.
    const ranking = await (await call("/v1/rankings/weekly")).json();
    expect((ranking as { entries: unknown[] }).entries).toHaveLength(0);
    const slug = queue.creators[0]?.slug ?? "";
    expect((await call(`/v1/creators/${slug}`)).status).toBe(404);
  });

  test("rejects an unsafe or unsupported URL without creating anything", async () => {
    for (const url of [
      "javascript:alert(1)",
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:5432/",
      "https://instagram.com",
      "not a url",
    ]) {
      const result = await submit(url);
      expect(result.outcome, url).toBe("INVALID_URL");
    }
    expect((await pendingQueue()).total).toBe(0);
  });

  test("refuses a duplicate however the URL is spelled", async () => {
    expect((await submit("https://instagram.com/rafaonda")).outcome).toBe("SUBMITTED");
    for (const variant of [
      "https://www.instagram.com/rafaonda/",
      "http://INSTAGRAM.com/RafaOnda?hl=pt",
      "instagram.com/rafaonda#reels",
    ]) {
      expect((await submit(variant)).outcome, variant).toBe("ALREADY_PENDING");
    }
    expect((await pendingQueue()).total).toBe(1);
  });

  test("points at the existing profile when the creator is already public", async () => {
    await submit("https://instagram.com/rafaonda");
    const queue = await pendingQueue();
    const id = queue.creators[0]?.id ?? "";
    await post(`/internal/admin/creators/${id}/approve`, {}, adminHeaders);

    const again = await submit("https://instagram.com/rafaonda");
    expect(again.outcome).toBe("ALREADY_EXISTS");
    expect(again.creatorSlug).toBe(queue.creators[0]?.slug ?? "");
  });

  test("refuses a profile that verified an opt-out", async () => {
    await suppressKey(testDatabase.db, "instagram:removida", "creator.opted_out");
    const result = await submit("https://instagram.com/removida");
    expect(result.outcome).toBe("SUPPRESSED");
    expect((await pendingQueue()).total).toBe(0);
  });

  test("throttles a flood of submissions", async () => {
    for (let index = 0; index < 5; index += 1) {
      expect((await submit(`https://instagram.com/criadora${index}`)).outcome).toBe("SUBMITTED");
    }
    const response = await post("/v1/creators/submissions", {
      url: "https://instagram.com/criadora99",
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).not.toBeNull();
  });
});

describe("administration authorization", () => {
  test("refuses every admin route without the shared secret", async () => {
    const routes: Array<[string, RequestInit]> = [
      ["/internal/admin/creators", {}],
      ["/internal/admin/reports", {}],
      ["/internal/admin/audit-logs", {}],
    ];
    for (const [path, init] of routes) {
      expect((await call(path, init)).status, path).toBe(401);
    }
    const approve = await post(
      "/internal/admin/creators/11111111-1111-4111-8111-111111111111/approve",
      {},
    );
    expect(approve.status).toBe(401);
  });

  test("refuses a wrong secret and one of a different length", async () => {
    for (const secret of ["", "wrong", `${ADMIN_SECRET}x`, ADMIN_SECRET.toUpperCase()]) {
      const response = await call("/internal/admin/creators", {
        headers: { "x-admin-api-secret": secret },
      });
      expect(response.status, secret).toBe(401);
    }
  });
});

describe("moderation decisions", () => {
  async function submitAndGetId(url = "https://instagram.com/novacriadora"): Promise<string> {
    await submit(url);
    const queue = await pendingQueue();
    return queue.creators[0]?.id ?? "";
  }

  test("approving makes the creator public", async () => {
    const id = await submitAndGetId();
    const response = await post(`/internal/admin/creators/${id}/approve`, {}, adminHeaders);
    expect(response.status).toBe(200);

    const queue = await pendingQueue();
    expect(queue.total).toBe(0);

    const approved = await call("/internal/admin/creators?status=APPROVED", {
      headers: adminHeaders,
    });
    const list = parseContract(AdminCreatorListDto, await approved.json(), "AdminCreatorList");
    const slug = list.creators[0]?.slug ?? "";
    const detail = await call(`/v1/creators/${slug}`);
    expect(detail.status).toBe(200);
    const creator = parseContract(CreatorDetailDto, await detail.json(), "CreatorDetail");
    expect(creator.slug).toBe(slug);
  });

  test("approving can complete the metadata moderation had to supply", async () => {
    const id = await submitAndGetId();
    await post(
      `/internal/admin/creators/${id}/approve`,
      {
        displayName: "Nova Criadora",
        bio: "Bio confirmada",
        avatarUrl: "https://cdn.exemplo/a.png",
      },
      adminHeaders,
    );
    const approved = await call("/internal/admin/creators?status=APPROVED", {
      headers: adminHeaders,
    });
    const list = parseContract(AdminCreatorListDto, await approved.json(), "AdminCreatorList");
    expect(list.creators[0]?.displayName).toBe("Nova Criadora");
    expect(list.creators[0]?.bio).toBe("Bio confirmada");
  });

  test("rejecting keeps the creator out of public view and records the reason", async () => {
    const id = await submitAndGetId();
    await post(`/internal/admin/creators/${id}/reject`, { reason: "IMPERSONATION" }, adminHeaders);

    const rejected = await call("/internal/admin/creators?status=REJECTED", {
      headers: adminHeaders,
    });
    const list = parseContract(AdminCreatorListDto, await rejected.json(), "AdminCreatorList");
    expect(list.creators[0]?.rejectionReason).toBe("IMPERSONATION");
    expect((await call(`/v1/creators/${list.creators[0]?.slug ?? ""}`)).status).toBe(404);
  });

  test("refuses a transition the lifecycle does not allow", async () => {
    const id = await submitAndGetId();
    await post(`/internal/admin/creators/${id}/approve`, {}, adminHeaders);
    // Approving an already-approved creator is not a legal move.
    const again = await post(`/internal/admin/creators/${id}/approve`, {}, adminHeaders);
    expect(again.status).toBe(422);
  });

  test("answers 404 for a creator that does not exist", async () => {
    const response = await post(
      "/internal/admin/creators/11111111-1111-4111-8111-111111111111/approve",
      {},
      adminHeaders,
    );
    expect(response.status).toBe(404);
  });

  test("writes an audit entry for every decision", async () => {
    const id = await submitAndGetId();
    await post(`/internal/admin/creators/${id}/approve`, {}, adminHeaders);
    await post(`/internal/admin/creators/${id}/remove`, { note: "pedido interno" }, adminHeaders);

    const response = await call("/internal/admin/audit-logs", { headers: adminHeaders });
    const body = (await response.json()) as {
      entries: Array<{ action: string; targetId: string }>;
    };
    const actions = body.entries.map((entry) => entry.action);
    expect(actions).toContain("creator.approved");
    expect(actions).toContain("creator.removed");
    expect(body.entries.every((entry) => entry.targetId === id)).toBe(true);
  });

  test("a removed creator can be restored", async () => {
    const id = await submitAndGetId();
    await post(`/internal/admin/creators/${id}/approve`, {}, adminHeaders);
    await post(`/internal/admin/creators/${id}/remove`, {}, adminHeaders);
    expect((await post(`/internal/admin/creators/${id}/restore`, {}, adminHeaders)).status).toBe(
      200,
    );
    const approved = await call("/internal/admin/creators?status=APPROVED", {
      headers: adminHeaders,
    });
    const list = parseContract(AdminCreatorListDto, await approved.json(), "AdminCreatorList");
    expect(list.total).toBe(1);
  });
});

describe("opt-out", () => {
  async function approvedCreator(slug = "criadora-teste") {
    const category = await insertCategory(testDatabase.db, {
      slug: "outros",
      name: "Outros",
      isActive: false,
    });
    const creator = await insertCreator(testDatabase.db, {
      categoryId: category.id,
      slug,
      moderationStatus: "APPROVED",
      handle: slug.replace(/-/g, ""),
    });
    await insertBoost(testDatabase.db, {
      creatorId: creator.id,
      amountCents: 10_000,
      confirmedAt: NOW,
    });
    return creator;
  }

  test("an unverified request changes nothing public", async () => {
    const creator = await approvedCreator();
    const response = await post(`/v1/creators/${creator.slug}/opt-out`, {});
    expect(response.status).toBe(200);
    const challenge = parseContract(OptOutChallengeDto, await response.json(), "OptOutChallenge");
    expect(challenge.code).toMatch(/^CO-[2-9A-HJ-NP-Z]{8}$/);

    // Anyone can send that request, so it must not move the creator anywhere:
    // otherwise a stranger could knock the current #1 off the billboard with a
    // single click. The creator stays APPROVED, visible and ranked.
    const approved = await call("/internal/admin/creators?status=APPROVED", {
      headers: adminHeaders,
    });
    const list = parseContract(AdminCreatorListDto, await approved.json(), "AdminCreatorList");
    expect(list.total).toBe(1);

    expect((await call(`/v1/creators/${creator.slug}`)).status).toBe(200);
    const weekly = (await (await call("/v1/rankings/weekly")).json()) as { entries: unknown[] };
    expect(weekly.entries).toHaveLength(1);
  });

  test("a pending request never suppresses the profile", async () => {
    await submit("https://instagram.com/aindaaqui");
    const queue = await pendingQueue();
    const id = queue.creators[0]?.id ?? "";
    const slug = queue.creators[0]?.slug ?? "";
    await post(`/internal/admin/creators/${id}/approve`, {}, adminHeaders);
    await post(`/v1/creators/${slug}/opt-out`, {});

    // Nothing was suppressed, so the identity is still merely a duplicate.
    expect((await submit("https://instagram.com/aindaaqui")).outcome).toBe("ALREADY_EXISTS");
  });

  test("an administrator can still hold a profile during a disputed removal", async () => {
    const creator = await approvedCreator();
    await post(`/v1/creators/${creator.slug}/opt-out`, {});
    // The status exists for a human decision, never for the request itself.
    const held = await post(`/internal/admin/creators/${creator.id}/remove`, {}, adminHeaders);
    expect(held.status).toBe(200);
    expect((await call(`/v1/creators/${creator.slug}`)).status).toBe(404);
  });

  test("repeating the request returns the same code instead of issuing another", async () => {
    const creator = await approvedCreator();
    const first = parseContract(
      OptOutChallengeDto,
      await (await post(`/v1/creators/${creator.slug}/opt-out`, {})).json(),
      "OptOutChallenge",
    );
    const second = parseContract(
      OptOutChallengeDto,
      await (await post(`/v1/creators/${creator.slug}/opt-out`, {})).json(),
      "OptOutChallenge",
    );
    expect(second.code).toBe(first.code);
  });

  test("verification with the wrong text changes nothing", async () => {
    const creator = await approvedCreator();
    await post(`/v1/creators/${creator.slug}/opt-out`, {});
    const response = await post(`/v1/creators/${creator.slug}/opt-out/verify`, {
      profileText: "bio sem nenhum código",
    });
    const result = parseContract(
      OptOutVerificationResponseDto,
      await response.json(),
      "OptOutVerificationResponse",
    );
    expect(result.outcome).toBe("CODE_NOT_FOUND");

    const admin = await call("/internal/admin/creators?status=OPTED_OUT", {
      headers: adminHeaders,
    });
    const list = parseContract(AdminCreatorListDto, await admin.json(), "AdminCreatorList");
    expect(list.total).toBe(0);
  });

  test("a verified opt-out hides the creator immediately and everywhere", async () => {
    const creator = await approvedCreator();
    const challenge = parseContract(
      OptOutChallengeDto,
      await (await post(`/v1/creators/${creator.slug}/opt-out`, {})).json(),
      "OptOutChallenge",
    );

    const response = await post(`/v1/creators/${creator.slug}/opt-out/verify`, {
      profileText: `música · ${challenge.code} · são paulo`,
    });
    const result = parseContract(
      OptOutVerificationResponseDto,
      await response.json(),
      "OptOutVerificationResponse",
    );
    expect(result.outcome).toBe("VERIFIED");

    // Gone from the creator page, the weekly ranking and the all-time ranking.
    expect((await call(`/v1/creators/${creator.slug}`)).status).toBe(404);
    const weekly = (await (await call("/v1/rankings/weekly")).json()) as { entries: unknown[] };
    const allTime = (await (await call("/v1/rankings/all-time")).json()) as { entries: unknown[] };
    expect(weekly.entries).toHaveLength(0);
    expect(allTime.entries).toHaveLength(0);
  });

  test("a verified opt-out blocks resubmission of the same profile", async () => {
    await submit("https://instagram.com/vaisair");
    const queue = await pendingQueue();
    const id = queue.creators[0]?.id ?? "";
    const slug = queue.creators[0]?.slug ?? "";
    await post(`/internal/admin/creators/${id}/approve`, {}, adminHeaders);

    const challenge = parseContract(
      OptOutChallengeDto,
      await (await post(`/v1/creators/${slug}/opt-out`, {})).json(),
      "OptOutChallenge",
    );
    await post(`/v1/creators/${slug}/opt-out/verify`, { profileText: challenge.code });

    const resubmitted = await submit("https://www.instagram.com/vaisair/");
    expect(resubmitted.outcome).toBe("SUPPRESSED");
  });

  test("an opted-out creator cannot be restored by an administrator", async () => {
    await submit("https://instagram.com/vaisair");
    const queue = await pendingQueue();
    const id = queue.creators[0]?.id ?? "";
    const slug = queue.creators[0]?.slug ?? "";
    await post(`/internal/admin/creators/${id}/approve`, {}, adminHeaders);
    const challenge = parseContract(
      OptOutChallengeDto,
      await (await post(`/v1/creators/${slug}/opt-out`, {})).json(),
      "OptOutChallenge",
    );
    await post(`/v1/creators/${slug}/opt-out/verify`, { profileText: challenge.code });

    const restore = await post(`/internal/admin/creators/${id}/restore`, {}, adminHeaders);
    expect(restore.status).toBe(422);
  });

  test("answers 404 for a profile that does not exist", async () => {
    expect((await post("/v1/creators/nao-existe/opt-out", {})).status).toBe(404);
  });
});

describe("reports", () => {
  test("records a report against a public creator", async () => {
    const category = await insertCategory(testDatabase.db, {
      slug: "outros",
      name: "Outros",
      isActive: false,
    });
    const creator = await insertCreator(testDatabase.db, {
      categoryId: category.id,
      slug: "denunciada",
      moderationStatus: "APPROVED",
    });

    const response = await post(`/v1/creators/${creator.slug}/reports`, {
      reason: "IMPERSONATION",
      details: "Perfil falso",
    });
    expect(response.status).toBe(200);

    const reports = await call("/internal/admin/reports", { headers: adminHeaders });
    const body = (await reports.json()) as {
      reports: Array<{ creatorSlug: string; reason: string }>;
    };
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0]?.creatorSlug).toBe("denunciada");
  });

  test("acknowledges without confirming that a hidden profile exists", async () => {
    const category = await insertCategory(testDatabase.db, {
      slug: "outros",
      name: "Outros",
      isActive: false,
    });
    await insertCreator(testDatabase.db, {
      categoryId: category.id,
      slug: "escondida",
      moderationStatus: "PENDING_REVIEW",
    });

    const hidden = await post("/v1/creators/escondida/reports", { reason: "OTHER" });
    const missing = await post("/v1/creators/nunca-existiu/reports", { reason: "OTHER" });
    expect(hidden.status).toBe(missing.status);
    expect(await hidden.json()).toEqual(await missing.json());

    const reports = await call("/internal/admin/reports", { headers: adminHeaders });
    expect(((await reports.json()) as { reports: unknown[] }).reports).toHaveLength(0);
  });
});
