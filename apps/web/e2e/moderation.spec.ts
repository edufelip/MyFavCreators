import { expect, test } from "@playwright/test";
import { ADMIN_ORIGIN, signInToAdmin } from "./support/admin";

/** A handle nothing else in the suite uses, so runs never collide. */
function uniqueHandle(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

test.describe("submission and moderation", () => {
  test("a submitted creator is invisible until an administrator approves it", async ({ page }) => {
    const handle = uniqueHandle("criadorae2e");

    await page.goto("/enviar");
    await page.getByLabel("Link do perfil").fill(`https://instagram.com/${handle}`);
    await page.getByRole("button", { name: "Enviar para análise" }).click();

    const result = page.getByTestId("submission-result");
    await expect(result).toHaveAttribute("data-outcome", "SUBMITTED");

    // Not on the leaderboard yet.
    await page.goto("/");
    await expect(page.getByTestId("creator-card").filter({ hasText: handle })).toHaveCount(0);

    // Approve it in the administration app.
    await signInToAdmin(page);
    const card = page.getByTestId("moderation-card").filter({ hasText: handle });
    await expect(card).toHaveCount(1);
    const slug = await card.getAttribute("data-creator-slug");
    expect(slug).not.toBeNull();
    await card.getByTestId("approve-button").click();
    await expect(card).toHaveCount(0);

    // Now the public creator page exists.
    await page.goto(`/criador/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("creator-weekly-amount")).toBeVisible();
  });

  test("a duplicate submission is refused however the URL is spelled", async ({ page }) => {
    const handle = uniqueHandle("duplicadae2e");

    await page.goto("/enviar");
    await page.getByLabel("Link do perfil").fill(`https://instagram.com/${handle}`);
    await page.getByRole("button", { name: "Enviar para análise" }).click();
    await expect(page.getByTestId("submission-result")).toHaveAttribute(
      "data-outcome",
      "SUBMITTED",
    );

    await page.reload();
    await page.getByLabel("Link do perfil").fill(`https://WWW.instagram.com/${handle}/?hl=pt`);
    await page.getByRole("button", { name: "Enviar para análise" }).click();
    await expect(page.getByTestId("submission-result")).toHaveAttribute(
      "data-outcome",
      "ALREADY_PENDING",
    );
  });

  test("an unsafe URL is refused before anything is created", async ({ page }) => {
    await page.goto("/enviar");
    // A private address a server-side fetch must never be pointed at.
    await page.getByLabel("Link do perfil").fill("http://169.254.169.254/latest/meta-data/");
    await page.getByRole("button", { name: "Enviar para análise" }).click();
    await expect(page.getByTestId("submission-result")).toHaveAttribute(
      "data-outcome",
      "INVALID_URL",
    );
  });

  test("a rejected creator never becomes public", async ({ page }) => {
    const handle = uniqueHandle("rejeitadae2e");

    await page.goto("/enviar");
    await page.getByLabel("Link do perfil").fill(`https://twitch.tv/${handle}`);
    await page.getByRole("button", { name: "Enviar para análise" }).click();
    await expect(page.getByTestId("submission-result")).toHaveAttribute(
      "data-outcome",
      "SUBMITTED",
    );

    await signInToAdmin(page);
    const card = page.getByTestId("moderation-card").filter({ hasText: handle });
    const slug = await card.getAttribute("data-creator-slug");
    await card.getByTestId("reject-button").click();
    await expect(card).toHaveCount(0);

    const response = await page.goto(`/criador/${slug}`);
    expect(response?.status()).toBe(404);
  });
});

test.describe("administration access", () => {
  test("every administration page requires a session", async ({ page }) => {
    for (const path of ["/moderacao", "/denuncias", "/auditoria"]) {
      await page.goto(`${ADMIN_ORIGIN}${path}`);
      await expect(page, path).toHaveURL(/\/login/);
    }
  });

  test("signing out ends the session", async ({ page }) => {
    await signInToAdmin(page);
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto(`${ADMIN_ORIGIN}/moderacao`);
    await expect(page).toHaveURL(/\/login/);
  });

  test("the administration session cookie is not readable by scripts", async ({
    page,
    context,
  }) => {
    await signInToAdmin(page);
    const cookies = await context.cookies();
    const session = cookies.find((cookie) => cookie.name === "co_admin_session");
    expect(session).toBeDefined();
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Strict");
    // And nothing readable from the page carries the secret.
    const documentCookie = await page.evaluate(() => document.cookie);
    expect(documentCookie).not.toContain("co_admin_session");
  });

  test("the admin API secret never reaches the browser", async ({ page }) => {
    await signInToAdmin(page);
    const html = await page.content();
    expect(html).not.toContain("dev-admin-api-secret");
    expect(html).not.toContain("x-admin-api-secret");
  });
});

test.describe("creator removal", () => {
  test("a removal request alone does not hide the creator, but verification does", async ({
    page,
  }) => {
    const handle = uniqueHandle("saie2e");

    await page.goto("/enviar");
    await page.getByLabel("Link do perfil").fill(`https://tiktok.com/@${handle}`);
    await page.getByRole("button", { name: "Enviar para análise" }).click();
    await expect(page.getByTestId("submission-result")).toHaveAttribute(
      "data-outcome",
      "SUBMITTED",
    );

    await signInToAdmin(page);
    const card = page.getByTestId("moderation-card").filter({ hasText: handle });
    const slug = await card.getAttribute("data-creator-slug");
    await card.getByTestId("approve-button").click();
    await expect(card).toHaveCount(0);

    await page.goto(`/criador/${slug}`);
    await page.getByTestId("ownership-toggle").click();
    await page.getByTestId("opt-out-request").click();

    const code = await page.getByTestId("opt-out-code").innerText();
    expect(code).toMatch(/^CO-[2-9A-HJ-NP-Z]{8}$/);

    // Still public: asking is not proving.
    const stillThere = await page.goto(`/criador/${slug}`);
    expect(stillThere?.status()).toBe(200);

    // A wrong text changes nothing either.
    await page.getByTestId("ownership-toggle").click();
    await page.getByLabel("Cole aqui a bio ou descrição do perfil com o código").fill("sem código");
    await page.getByTestId("opt-out-verify").click();
    await expect(page.getByTestId("opt-out-result")).toHaveAttribute(
      "data-outcome",
      "CODE_NOT_FOUND",
    );
    expect((await page.goto(`/criador/${slug}`))?.status()).toBe(200);

    // Proving control hides the creator immediately.
    await page.getByTestId("ownership-toggle").click();
    await page
      .getByLabel("Cole aqui a bio ou descrição do perfil com o código")
      .fill(`música · ${code} · são paulo`);
    await page.getByTestId("opt-out-verify").click();
    await expect(page.getByTestId("opt-out-result")).toHaveAttribute("data-outcome", "VERIFIED");

    expect((await page.goto(`/criador/${slug}`))?.status()).toBe(404);

    // And the profile cannot be resubmitted.
    await page.goto("/enviar");
    await page.getByLabel("Link do perfil").fill(`https://tiktok.com/@${handle}`);
    await page.getByRole("button", { name: "Enviar para análise" }).click();
    await expect(page.getByTestId("submission-result")).toHaveAttribute(
      "data-outcome",
      "SUPPRESSED",
    );
  });
});
