import { expect, test } from "@playwright/test";
import { affirmativeUses, forbiddenTerms } from "../src/lib/forbidden-copy";
import { platformText } from "./support/page-text";

/**
 * Browsing by category.
 *
 * The homepage ranks everybody against everybody, which buries a creator who is
 * the best in their own field behind whoever spent most overall. A category
 * page is the surface where that creator is findable — and it is the page a
 * search for "melhores criadores de música" can actually land on.
 */
test.describe("a category page", () => {
  test("is reachable from the category on a creator card", async ({ page }) => {
    await page.goto("/");
    const link = page.getByTestId("creator-category-link").first();
    await expect(link).toBeVisible();

    const href = await link.getAttribute("href");
    expect(href).toMatch(/^\/categoria\/[a-z0-9-]+$/);

    await link.click();
    await expect(page).toHaveURL(/\/categoria\//);
    await expect(page.getByTestId("category-title")).toBeVisible();
  });

  test("shows only creators from that category", async ({ page }) => {
    await page.goto("/");
    const href = await page.getByTestId("creator-category-link").first().getAttribute("href");
    const slug = (href ?? "").split("/").pop() ?? "";
    await page.goto(href ?? "/");

    const links = page.getByTestId("creator-category-link");
    const count = await links.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      expect(await links.nth(index).getAttribute("href")).toBe(`/categoria/${slug}`);
    }
  });

  test("keeps the category when the visitor switches ranking tab", async ({ page }) => {
    await page.goto("/");
    const href = await page.getByTestId("creator-category-link").first().getAttribute("href");
    await page.goto(href ?? "/");

    await page.getByRole("tab", { name: "Geral" }).click();
    await expect(page).toHaveURL(new RegExp(`${href}\\?ranking=geral`));
    await expect(page.getByTestId("category-title")).toBeVisible();
  });

  test("is a 404 for a category that does not exist", async ({ page }) => {
    const response = await page.goto("/categoria/nao-existe-mesmo");
    expect(response?.status()).toBe(404);
  });

  test("never implies a payout, a donation or a game of chance", async ({ page }) => {
    await page.goto("/");
    const href = await page.getByTestId("creator-category-link").first().getAttribute("href");
    await page.goto(href ?? "/");

    // A creator's own display name is theirs, so it is stripped before the
    // check: the rule is about what the platform says, not about what somebody
    // called themselves.
    const text = await platformText(page);
    expect(forbiddenTerms(text)).toEqual([]);
    expect(affirmativeUses(text)).toEqual([]);
  });

  test("tells a crawler which URL is canonical", async ({ page }) => {
    await page.goto("/");
    const href = await page.getByTestId("creator-category-link").first().getAttribute("href");
    await page.goto(`${href}?ranking=geral`);

    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toContain(href ?? "");
    expect(canonical).not.toContain("ranking=geral");
  });
});

test.describe("the sitemap", () => {
  test("lists the category pages as well as the creators", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.ok()).toBe(true);

    const body = await response.text();
    expect(body).toContain("/categoria/");
    expect(body).toContain("/criador/");
  });
});
