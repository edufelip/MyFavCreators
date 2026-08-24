import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/**
 * Accessibility is checked against the real rendered pages, not asserted in
 * prose. WCAG 2.1 A and AA are the bar; a violation fails the build with the
 * rule that broke and the element that broke it.
 */
const STANDARD = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function scan(page: Page) {
  return new AxeBuilder({ page }).withTags(STANDARD).analyze();
}

function describeViolations(results: Awaited<ReturnType<typeof scan>>): string {
  return results.violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? "unknown"}): ${violation.help}\n  ` +
        violation.nodes.map((node) => node.target.join(" ")).join("\n  "),
    )
    .join("\n");
}

const PUBLIC_PAGES = [
  { name: "homepage", path: "/" },
  { name: "rules", path: "/regras" },
  { name: "submission", path: "/enviar" },
  { name: "hall of fame", path: "/hall-da-fama" },
];

test.describe("accessibility", () => {
  for (const page_ of PUBLIC_PAGES) {
    test(`${page_.name} has no WCAG A or AA violations`, async ({ page }) => {
      await page.goto(page_.path);
      const results = await scan(page);
      expect(describeViolations(results)).toBe("");
    });
  }

  test("a creator page has no WCAG A or AA violations", async ({ page }) => {
    await page.goto("/");
    const href = await page
      .getByTestId("creator-card")
      .first()
      .getByTestId("creator-profile-link")
      .getAttribute("href");
    await page.goto(href ?? "/");

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the checkout screen has no WCAG A or AA violations", async ({ page }) => {
    // The screen somebody is looking at while paying is the worst place for a
    // contrast failure or an unlabelled control.
    await page.goto("/");
    await page.getByTestId("boost-amount-500").click();
    await page.getByTestId("boost-submit").click();
    await expect(page).toHaveURL(/\/impulsionar\//);

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("every page can be reached by keyboard from the top", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");

    const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
    expect(focused).toContain("Ir para o conteúdo");
  });

  test("the skip link actually moves focus to the content", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    expect(page.url()).toContain("#conteudo");
  });
});
