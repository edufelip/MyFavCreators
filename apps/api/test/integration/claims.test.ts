import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { PRODUCT_DEFAULTS } from "@creator-outdoor/config";
import {
  ClaimChallengeDto,
  ClaimVerificationResponseDto,
  CreatorDashboardDto,
  CreatorDetailDto,
  parseContract,
} from "@creator-outdoor/contracts";
import {
  createTestDatabase,
  insertBoost,
  insertCategory,
  insertCreator,
  setCreatorModerationStatus,
  type TestDatabase,
} from "@creator-outdoor/testkit";
import { createApp } from "../../src/app";
import { ConsoleEmailProvider } from "../../src/email/console";
import { RateLimiter } from "../../src/security/rate-limit";

const NOW = new Date("2026-08-19T18:30:00.000Z");

const testDatabase: TestDatabase = await createTestDatabase();
const rateLimiter = new RateLimiter();
const email = new ConsoleEmailProvider();
const app = createApp({
  database: testDatabase.db,
  product: PRODUCT_DEFAULTS,
  allowedOrigins: ["http://localhost:3000"],
  adminApiSecret: "integration-admin-secret-value",
  fanIdentitySecret: "um-segredo-de-identidade-de-fa-com-32-bytes",
  emailProvider: email,
  webOrigin: "http://localhost:3000",
  rateLimiter,
  now: () => NOW,
});

let creatorId = "";

beforeEach(async () => {
  await testDatabase.truncate();
  rateLimiter.reset();
  email.clear();
  const category = await insertCategory(testDatabase.db, {
    slug: "musica",
    name: "Musica",
    isActive: true,
  });
  await insertCategory(testDatabase.db, { slug: "jogos", name: "Jogos", isActive: true });
  const creator = await insertCreator(testDatabase.db, {
    categoryId: category.id,
    slug: "luna-verso",
    displayName: "Luna Verso",
    moderationStatus: "APPROVED",
  });
  creatorId = creator.id;
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

async function requestClaim(slug = "luna-verso"): Promise<string> {
  const response = await post(`/v1/creators/${slug}/claims`, {});
  expect(response.status).toBe(200);
  const challenge = parseContract(ClaimChallengeDto, await response.json(), "ClaimChallenge");
  return challenge.code;
}

async function verifyClaim(
  code: string,
  options: { readonly slug?: string; readonly email?: string } = {},
) {
  const response = await post(`/v1/creators/${options.slug ?? "luna-verso"}/claims/verify`, {
    profileText: `Musica e coisas boas. ${code}`,
    ...(options.email === undefined ? {} : { email: options.email }),
  });
  expect(response.status).toBe(200);
  return parseContract(
    ClaimVerificationResponseDto,
    await response.json(),
    "ClaimVerificationResponse",
  );
}

async function claimed(): Promise<string> {
  const verified = await verifyClaim(await requestClaim());
  expect(verified.outcome).toBe("VERIFIED");
  expect(verified.manageToken).not.toBeNull();
  return verified.manageToken ?? "";
}

function authorized(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function dashboard(token: string): Promise<CreatorDashboardDto> {
  const response = await call("/v1/creators/me", { headers: authorized(token) });
  expect(response.status).toBe(200);
  return parseContract(CreatorDashboardDto, await response.json(), "CreatorDashboard");
}

async function publicDetail(slug = "luna-verso"): Promise<CreatorDetailDto> {
  const response = await call(`/v1/creators/${slug}`);
  return parseContract(CreatorDetailDto, await response.json(), "CreatorDetail");
}

describe("claiming a profile", () => {
  test("issues a code and changes nothing public", async () => {
    const before = await publicDetail();
    const code = await requestClaim();

    expect(code.length).toBeGreaterThan(4);
    const after = await publicDetail();
    // An unauthenticated visitor asking about a profile must never move it.
    expect(after.weekly).toEqual(before.weekly);
    expect(after.displayName).toBe(before.displayName);
  });

  test("returns the open code rather than minting a second one", async () => {
    expect(await requestClaim()).toBe(await requestClaim());
  });

  test("hands over a management token when the code is on the profile", async () => {
    const verified = await verifyClaim(await requestClaim());
    expect(verified.outcome).toBe("VERIFIED");
    expect((verified.manageToken ?? "").length).toBeGreaterThan(20);
    expect((await publicDetail()).claimStatus).toBe("CLAIMED");
  });

  test("refuses when the code is not on the profile", async () => {
    await requestClaim();
    const response = await post("/v1/creators/luna-verso/claims/verify", {
      profileText: "nenhum codigo por aqui",
    });
    const result = parseContract(
      ClaimVerificationResponseDto,
      await response.json(),
      "ClaimVerificationResponse",
    );
    expect(result.outcome).toBe("CODE_NOT_FOUND");
    expect(result.manageToken).toBeNull();
    expect((await publicDetail()).claimStatus).not.toBe("CLAIMED");
  });

  test("refuses a verification with no open request", async () => {
    const result = await verifyClaim("ABCD-EFGH");
    expect(result.outcome).toBe("NO_OPEN_REQUEST");
    expect(result.manageToken).toBeNull();
  });

  test("never claims a creator who is not public", async () => {
    await setCreatorModerationStatus(testDatabase.db, creatorId, "REMOVED");
    expect((await post("/v1/creators/luna-verso/claims", {})).status).toBe(404);
  });

  test("re-verifying replaces the token, so a lost one stops working", async () => {
    const first = await claimed();
    expect((await call("/v1/creators/me", { headers: authorized(first) })).status).toBe(200);

    const second = await claimed();
    expect(second).not.toBe(first);
    expect((await call("/v1/creators/me", { headers: authorized(second) })).status).toBe(200);
    expect((await call("/v1/creators/me", { headers: authorized(first) })).status).toBe(401);
  });

  test("never stores the management token in the clear", async () => {
    const token = await claimed();
    const rows = (await testDatabase.db.execute(
      "select token_hash from creator_claims" as never,
    )) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.["token_hash"])).not.toContain(token);
    expect(String(rows[0]?.["token_hash"])).toMatch(/^[0-9a-f]{64}$/);
  });

  test("records the claim in the audit log without the token", async () => {
    const token = await claimed();
    const logs = await call("/internal/admin/audit-logs", {
      headers: {
        "x-admin-api-secret": "integration-admin-secret-value",
        "x-admin-actor": "edu",
      },
    });
    const body = await logs.text();
    expect(body).toContain("creator.claimed");
    expect(body).not.toContain(token);
  });
});

describe("the management session", () => {
  test("refuses a request with no token, a wrong one, or a malformed header", async () => {
    await claimed();
    expect((await call("/v1/creators/me")).status).toBe(401);
    expect((await call("/v1/creators/me", { headers: authorized("x".repeat(43)) })).status).toBe(
      401,
    );
    expect(
      (await call("/v1/creators/me", { headers: { authorization: "Basic abc" } })).status,
    ).toBe(401);
  });

  test("stops working when the profile stops being public", async () => {
    const token = await claimed();
    await setCreatorModerationStatus(testDatabase.db, creatorId, "REMOVED");
    expect((await call("/v1/creators/me", { headers: authorized(token) })).status).toBe(401);
  });

  test("shows the same numbers the public page shows", async () => {
    const token = await claimed();
    await insertBoost(testDatabase.db, { creatorId, amountCents: 5_000, confirmedAt: NOW });

    const mine = await dashboard(token);
    const theirs = await publicDetail();
    expect(mine.weeklyAmountCents).toBe(theirs.weekly.amountCents);
    expect(mine.weeklyRank).toBe(theirs.weekly.rank);
    expect(mine.supporterCount).toBe(theirs.allTime.supporterCount);
  });
});

describe("editing a claimed profile", () => {
  test("changes the bio the public page shows", async () => {
    const token = await claimed();
    const response = await call("/v1/creators/me", {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authorized(token) },
      body: JSON.stringify({ bio: "  Faco musica.  " }),
    });
    expect(response.status).toBe(200);

    expect((await publicDetail()).bio).toBe("Faco musica.");
  });

  test("moves the profile to another category", async () => {
    const token = await claimed();
    await call("/v1/creators/me", {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authorized(token) },
      body: JSON.stringify({ categorySlug: "jogos" }),
    });
    expect((await publicDetail()).category.slug).toBe("jogos");
  });

  test("refuses a category nobody has", async () => {
    const token = await claimed();
    const response = await call("/v1/creators/me", {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authorized(token) },
      body: JSON.stringify({ categorySlug: "nao-existe" }),
    });
    expect(response.status).toBe(404);
  });

  test("never lets a claimant rewrite the name people recognise them by", async () => {
    // A claimed profile that could be renamed is a way to impersonate somebody
    // else after the fact, using a claim proven against a different account.
    const token = await claimed();
    await call("/v1/creators/me", {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authorized(token) },
      body: JSON.stringify({ bio: "oi", displayName: "Outra Pessoa", slug: "outra-pessoa" }),
    });

    const detail = await publicDetail();
    expect(detail.displayName).toBe("Luna Verso");
    expect(detail.slug).toBe("luna-verso");
  });

  test("refuses a bio longer than the profile allows", async () => {
    const token = await claimed();
    const response = await call("/v1/creators/me", {
      method: "PATCH",
      headers: { "content-type": "application/json", ...authorized(token) },
      body: JSON.stringify({ bio: "a".repeat(501) }),
    });
    expect(response.status).toBe(400);
  });

  test("cannot be done without a token", async () => {
    await claimed();
    const response = await call("/v1/creators/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bio: "invadido" }),
    });
    expect(response.status).toBe(401);
    expect((await publicDetail()).bio).not.toBe("invadido");
  });
});

describe("a claimed creator's own notifications", () => {
  test("are off until they ask for them", async () => {
    const token = await claimed();
    expect((await dashboard(token)).notifyDethrone).toBe(false);
  });

  test("are switched on with the address given at claim time", async () => {
    const verified = await verifyClaim(await requestClaim(), { email: "Luna@Example.com" });
    const token = verified.manageToken ?? "";

    const response = await call("/v1/creators/me/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", ...authorized(token) },
      body: JSON.stringify({ notifyDethrone: true, notifyWeeklyRecap: false }),
    });
    expect(await response.json()).toEqual({ notifyDethrone: true, notifyWeeklyRecap: false });
    expect((await dashboard(token)).notifyDethrone).toBe(true);
  });

  test("switches each notification independently", async () => {
    // One switch off must not take the other with it.
    const verified = await verifyClaim(await requestClaim(), { email: "luna@example.com" });
    const token = verified.manageToken ?? "";
    const response = await call("/v1/creators/me/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", ...authorized(token) },
      body: JSON.stringify({ notifyDethrone: false, notifyWeeklyRecap: true }),
    });
    expect(await response.json()).toEqual({ notifyDethrone: false, notifyWeeklyRecap: true });

    const board = await dashboard(token);
    expect(board.notifyDethrone).toBe(false);
    expect(board.notifyWeeklyRecap).toBe(true);
  });

  test("are switched off again on request", async () => {
    const verified = await verifyClaim(await requestClaim(), { email: "luna@example.com" });
    const token = verified.manageToken ?? "";
    const put = (notifyDethrone: boolean) =>
      call("/v1/creators/me/notifications", {
        method: "PUT",
        headers: { "content-type": "application/json", ...authorized(token) },
        body: JSON.stringify({ notifyDethrone, notifyWeeklyRecap: false }),
      });

    await put(true);
    await put(false);
    expect((await dashboard(token)).notifyDethrone).toBe(false);
  });

  test("cannot be switched on without somewhere to send them", async () => {
    const token = await claimed();
    const response = await call("/v1/creators/me/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", ...authorized(token) },
      body: JSON.stringify({ notifyDethrone: true, notifyWeeklyRecap: true }),
    });
    expect(await response.json()).toEqual({ notifyDethrone: false, notifyWeeklyRecap: false });
  });

  test("never appear on the public page", async () => {
    const verified = await verifyClaim(await requestClaim(), { email: "luna@example.com" });
    const token = verified.manageToken ?? "";
    await call("/v1/creators/me/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json", ...authorized(token) },
      body: JSON.stringify({ notifyDethrone: true, notifyWeeklyRecap: true }),
    });

    const body = await (await call("/v1/creators/luna-verso")).text();
    expect(body).not.toContain("luna@example.com");
  });
});
