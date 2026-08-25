import { expect, type Page, test } from "@playwright/test";
import { signInToAdmin } from "./support/admin";

const API_ORIGIN = process.env["API_ORIGIN"] ?? "http://localhost:3001";

function unique(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

/** A creator of this test's own, so nothing else in the suite is disturbed. */
async function createApprovedCreator(page: Page): Promise<string> {
  const handle = unique("avisose2e");

  await page.goto("/enviar");
  await page.getByLabel("Link do perfil").fill(`https://instagram.com/${handle}`);
  await page.getByRole("button", { name: "Enviar para análise" }).click();
  await expect(page.getByTestId("submission-result")).toHaveAttribute("data-outcome", "SUBMITTED");

  await signInToAdmin(page);

  const card = page.getByTestId("moderation-card").filter({ hasText: handle });
  await expect(card).toHaveCount(1);
  const slug = await card.getAttribute("data-creator-slug");
  await card.getByTestId("approve-button").click();
  await expect(card).toHaveCount(0);
  return slug ?? "";
}

test.describe("notification preferences", () => {
  test("a supporter can leave an address at checkout", async ({ page, request }) => {
    const slug = await createApprovedCreator(page);
    await page.goto(`/criador/${slug}`);

    await page.getByTestId("boost-amount-500").click();
    await page.getByTestId("boost-details-toggle").click();
    await page.getByTestId("boost-email").fill(`${unique("torcedora")}@example.com`);
    await page.getByTestId("boost-submit").click();
    await expect(page).toHaveURL(/\/impulsionar\//);

    const paymentId = page.url().split("/").pop() ?? "";
    const lookup = await request.get(`${API_ORIGIN}/dev/pix/lookup/${paymentId}`);
    const { providerPaymentId } = (await lookup.json()) as { providerPaymentId: string };
    const settled = await request.post(`${API_ORIGIN}/dev/pix/${providerPaymentId}/CONFIRMED`);
    expect(settled.ok()).toBe(true);

    // The address is private: it reaches no public surface, wall included.
    const profile = await page.goto(`/criador/${slug}`);
    expect((await profile?.text()) ?? "").not.toContain("@example.com");
  });

  test("an unsubscribe link asks before acting, then confirms", async ({ page }) => {
    // Mail clients prefetch links, so nothing may happen on load.
    await page.goto(`/descadastrar/${"a".repeat(43)}`);
    await expect(page.getByTestId("unsubscribe-submit")).toBeVisible();

    await page.getByTestId("unsubscribe-submit").click();
    const result = page.getByTestId("unsubscribe-result");
    await expect(result).toHaveAttribute("data-status", "done");
  });

  test("says the same thing for a token that never existed", async ({ page }) => {
    // A page that distinguished them would let anybody forwarded an email test
    // whether an address is subscribed.
    await page.goto(`/descadastrar/${"b".repeat(43)}`);
    await page.getByTestId("unsubscribe-submit").click();
    await expect(page.getByTestId("unsubscribe-result")).toHaveAttribute("data-status", "done");
  });

  test("one-click unsubscribe actually unsubscribes, and does not merely answer", async ({
    request,
  }) => {
    /*
     * The address in `List-Unsubscribe` used to be the confirmation page, and a
     * page cannot answer a POST — the one-click request was served the page's
     * own HTML with a 200, which Gmail, Yahoo and Apple Mail all read as
     * success. The reader was told they were unsubscribed and the next email
     * arrived anyway.
     *
     * So this posts the way a mail client does, and asserts on the status
     * rather than on the body: a 200 full of HTML is exactly the failure.
     */
    const response = await request.post(`/api/descadastrar/${"d".repeat(43)}`, {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      data: "List-Unsubscribe=One-Click",
      maxRedirects: 0,
    });

    expect(response.status()).toBe(204);
    expect(await response.text()).toBe("");
  });

  test("the same address sends a person to the confirmation page instead", async ({ request }) => {
    // A mail client prefetches links, so a GET must never act. It redirects.
    const response = await request.get(`/api/descadastrar/${"e".repeat(43)}`, {
      maxRedirects: 0,
    });
    expect([302, 303, 307, 308]).toContain(response.status());
    expect(response.headers()["location"]).toContain("/descadastrar/");
  });

  test("is never indexed", async ({ page }) => {
    const response = await page.goto(`/descadastrar/${"c".repeat(43)}`);
    const body = (await response?.text()) ?? "";
    expect(body).toContain("noindex");
  });
});
