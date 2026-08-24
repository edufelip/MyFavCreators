import { expect, type Page, test } from "@playwright/test";

const ADMIN_ORIGIN = process.env["ADMIN_ORIGIN"] ?? "http://localhost:3002";
const ADMIN_PASSWORD = process.env["E2E_ADMIN_PASSWORD"] ?? "creator-outdoor-dev";

function unique(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

/** A creator of this test's own, submitted and approved through the real flow. */
async function createApprovedCreator(page: Page): Promise<string> {
  const handle = unique("claime2e");

  await page.goto("/enviar");
  await page.getByLabel("Link do perfil").fill(`https://instagram.com/${handle}`);
  await page.getByRole("button", { name: "Enviar para análise" }).click();
  await expect(page.getByTestId("submission-result")).toHaveAttribute("data-outcome", "SUBMITTED");

  await page.goto(`${ADMIN_ORIGIN}/login`);
  await page.getByLabel("Senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/moderacao/);

  const card = page.getByTestId("moderation-card").filter({ hasText: handle });
  await expect(card).toHaveCount(1);
  const slug = await card.getAttribute("data-creator-slug");
  await card.getByTestId("approve-button").click();
  await expect(card).toHaveCount(0);
  return slug ?? "";
}

/** Proves control of a profile and lands on the management page. */
async function claimProfile(page: Page, slug: string, email?: string): Promise<void> {
  await page.goto(`/criador/${slug}`);
  await page.getByTestId("ownership-toggle").click();
  await page.getByTestId("claim-request").click();

  const code = await page.getByTestId("claim-code").innerText();
  expect(code.length).toBeGreaterThan(4);

  await page.getByTestId("claim-profile-text").fill(`Perfil oficial. ${code}`);
  if (email !== undefined) {
    await page.getByTestId("claim-email").fill(email);
  }
  await page.getByTestId("claim-verify").click();
  await expect(page).toHaveURL(/\/gerenciar/);
}

test.describe("claiming a profile", () => {
  test("takes a creator from a code in the bio to their own page", async ({ page }) => {
    const slug = await createApprovedCreator(page);
    await claimProfile(page, slug);

    const panel = page.getByTestId("manage-panel");
    await expect(panel).toBeVisible();
    expect(await panel.getAttribute("data-creator-slug")).toBe(slug);
  });

  test("refuses a claim when the code is not on the profile", async ({ page }) => {
    const slug = await createApprovedCreator(page);
    await page.goto(`/criador/${slug}`);
    await page.getByTestId("ownership-toggle").click();
    await page.getByTestId("claim-request").click();
    await page.getByTestId("claim-profile-text").fill("nenhum codigo por aqui");
    await page.getByTestId("claim-verify").click();

    await expect(page.getByTestId("claim-result")).toHaveAttribute(
      "data-outcome",
      "CODE_NOT_FOUND",
    );
    expect(page.url()).not.toContain("/gerenciar");
  });

  test("keeps the management token out of the URL and out of scripts", async ({ page }) => {
    const slug = await createApprovedCreator(page);
    await claimProfile(page, slug);

    // A token in a URL lands in history, referrers and access logs.
    expect(page.url()).toBe(new URL("/gerenciar", page.url()).toString());
    expect(await page.evaluate(() => document.cookie)).not.toContain("co_manage");
  });

  test("sends somebody with no claim away empty-handed", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/gerenciar");
    await expect(page.getByTestId("manage-signed-out")).toBeVisible();
    await expect(page.getByTestId("manage-panel")).toHaveCount(0);
  });
});

test.describe("managing a claimed profile", () => {
  test("edits the bio the public page shows", async ({ page }) => {
    const slug = await createApprovedCreator(page);
    await claimProfile(page, slug);

    const bio = unique("Faco musica ");
    await page.getByTestId("manage-bio").fill(bio);
    await page.getByTestId("manage-save").click();
    await expect(page.getByTestId("manage-profile-result")).toBeVisible();

    await page.goto(`/criador/${slug}`);
    await expect(page.getByText(bio)).toBeVisible();
  });

  test("shows the delivery the platform measured", async ({ page }) => {
    const slug = await createApprovedCreator(page);
    await claimProfile(page, slug);

    await expect(page.getByTestId("manage-impressions")).toBeVisible();
    await expect(page.getByTestId("manage-clicks")).toBeVisible();
    // Nothing shown yet means no rate to state, not a rate of zero.
    await expect(page.getByTestId("manage-ctr")).toContainText("sem exibições ainda");
  });

  test("offers an embed snippet pointing at this site", async ({ page }) => {
    const slug = await createApprovedCreator(page);
    await claimProfile(page, slug);

    const snippet = await page.getByTestId("manage-embed").innerText();
    expect(snippet).toContain(`/api/badge/${slug}.svg`);
    expect(snippet).toContain("<img");
    expect(snippet).not.toContain("<script");

    const badge = await page.request.get(`/api/badge/${slug}.svg`);
    expect(badge.status()).toBe(200);
    expect(badge.headers()["content-type"]).toContain("image/svg+xml");
    expect(await badge.text()).toContain("<svg");
  });

  test("keeps a notification preference the creator sets", async ({ page }) => {
    const slug = await createApprovedCreator(page);
    await claimProfile(page, slug, `${unique("criadora")}@example.com`);

    await page.getByTestId("manage-notify").check();
    await page.getByTestId("manage-notify-save").click();
    await expect(page.getByTestId("manage-notify-result")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("manage-notify")).toBeChecked();
  });

  test("ends the session on sign out", async ({ page }) => {
    const slug = await createApprovedCreator(page);
    await claimProfile(page, slug);

    await page.getByTestId("manage-sign-out").click();
    // Signing out redirects home; navigating before it lands would race the
    // response that clears the cookie.
    await expect(page).toHaveURL(new URL("/", page.url()).toString());

    await page.goto("/gerenciar");
    await expect(page.getByTestId("manage-signed-out")).toBeVisible();
  });

  test("is never indexed", async ({ page }) => {
    const slug = await createApprovedCreator(page);
    await claimProfile(page, slug);
    const response = await page.goto("/gerenciar");
    expect((await response?.text()) ?? "").toContain("noindex");
  });
});

test.describe("the Hall da Fama", () => {
  test("is reachable from every page and lists closed weeks", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Hall da Fama" }).click();
    await expect(page).toHaveURL(/\/hall-da-fama/);
    await expect(page.getByRole("heading", { name: "Hall da Fama", level: 1 })).toBeVisible();

    // The seed closes past weeks, so there is history to show.
    await expect(page.getByTestId("hall-entry").first()).toBeVisible();
  });

  test("links each champion to their profile", async ({ page }) => {
    await page.goto("/hall-da-fama");
    const first = page.getByTestId("hall-entry").first();
    const href = await first.getByRole("link").getAttribute("href");
    expect(href).toMatch(/^\/criador\//);

    await page.goto(href ?? "/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("shows a champion badge on the profile of a past winner", async ({ page }) => {
    await page.goto("/hall-da-fama");
    const href = await page
      .getByTestId("hall-entry")
      .first()
      .getByRole("link")
      .getAttribute("href");
    await page.goto(href ?? "/");
    await expect(page.getByTestId("champion-badge")).toBeVisible();
    await expect(page.getByTestId("champion-badge")).toContainText("#1");
  });
});
