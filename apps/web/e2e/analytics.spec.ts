import { expect, type Page, test } from "@playwright/test";

const API_ORIGIN = process.env["API_ORIGIN"] ?? "http://localhost:3001";

/** The leader, whose page and links are stable across the run. */
async function openLeaderProfile(page: Page): Promise<string> {
  await page.goto("/");
  const href = await page
    .getByTestId("creator-card")
    .first()
    .getByTestId("creator-profile-link")
    .getAttribute("href");
  await page.goto(href ?? "/");
  return href ?? "/";
}

async function deliveryFor(
  request: import("@playwright/test").APIRequestContext,
  slug: string,
): Promise<{ impressions: number; outboundClicks: number; clickThroughRate: number | null }> {
  const response = await request.get(`${API_ORIGIN}/v1/creators/${slug}/delivery?window=all-time`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    impressions: number;
    outboundClicks: number;
    clickThroughRate: number | null;
  };
}

test.describe("measured delivery", () => {
  test("counts the creators a page actually displayed", async ({ page, request }) => {
    const beacon = page.waitForResponse((response) => response.url().includes("/api/impressions"), {
      timeout: 20_000,
    });
    await page.goto("/");
    const slug =
      (await page
        .getByTestId("creator-card")
        .first()
        .getByTestId("creator-profile-link")
        .getAttribute("href")) ?? "";
    const leaderSlug = slug.replace("/criador/", "");

    // The page reports what it displayed, once it is actually visible.
    expect((await beacon).status()).toBe(204);
    await expect
      .poll(async () => (await deliveryFor(request, leaderSlug)).impressions, { timeout: 20_000 })
      .toBeGreaterThan(0);
  });

  test("sends no analytics identifier the page could read", async ({ page }) => {
    await page.goto("/");
    // The session cookie is httpOnly, so a script cannot mint sessions.
    const readable = await page.evaluate(() => document.cookie);
    expect(readable).not.toContain("co_sid");
  });
});

test.describe("the tracked outbound link", () => {
  test("redirects to the creator profile and counts the click", async ({ page, request }) => {
    const href = await openLeaderProfile(page);
    const slug = href.replace("/criador/", "");

    const link = page.getByTestId("creator-outbound-link").first();
    const outboundHref = await link.getAttribute("href");
    expect(outboundHref).toMatch(/^\/out\//);

    // Follow the redirect without leaving the site in the test browser.
    const response = await page.request.get(`${outboundHref}`, { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(response.status());
    const destination = response.headers()["location"] ?? "";
    expect(destination.startsWith("http")).toBe(true);
    expect(destination).not.toContain("/out/");

    // The click reaches the delivery report. How many are counted per session
    // and hour is deduplication, covered where the session is controlled; here
    // what matters is that a real click through a real page is measured at all.
    await expect
      .poll(async () => (await deliveryFor(request, slug)).outboundClicks, { timeout: 20_000 })
      .toBeGreaterThan(0);
  });

  test("never redirects to a link nobody has", async ({ page }) => {
    const response = await page.goto("/out/00000000-0000-4000-8000-000000000000");
    expect(response?.status()).toBe(404);
    // A dead link lands on the site's own page, not a browser error.
    await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
  });

  test("refuses a link id that is not an identifier at all", async ({ page }) => {
    const response = await page.goto("/out/https:%2F%2Fevil.example");
    expect(response?.status()).toBe(404);
    // Whatever the path looked like, the browser stayed on this site.
    expect(page.url().startsWith("http://localhost:3000/")).toBe(true);
    await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
  });
});
