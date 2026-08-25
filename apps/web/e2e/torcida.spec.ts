import { expect, type Page, test } from "@playwright/test";
import { signInToAdmin } from "./support/admin";

const API_ORIGIN = process.env["API_ORIGIN"] ?? "http://localhost:3001";

/** A value nothing else in the suite uses, so every assertion here is exact. */
function unique(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

async function settlePayment(
  request: import("@playwright/test").APIRequestContext,
  providerPaymentId: string,
) {
  const response = await request.post(`${API_ORIGIN}/dev/pix/${providerPaymentId}/CONFIRMED`);
  expect(response.ok()).toBe(true);
}

async function providerPaymentIdOf(
  request: import("@playwright/test").APIRequestContext,
  paymentId: string,
): Promise<string> {
  const response = await request.get(`${API_ORIGIN}/dev/pix/lookup/${paymentId}`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { providerPaymentId: string };
  return body.providerPaymentId;
}

/**
 * A creator of this test's own, submitted and approved through the real flow.
 *
 * The wall is then entirely this test's doing: no seeded supporters to page
 * past, and no other spec's boosts changing what is on it.
 */
async function createApprovedCreator(page: Page): Promise<string> {
  const handle = unique("torcidae2e");

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

  expect(slug).not.toBeNull();
  return slug ?? "";
}

/** Boosts the creator currently on screen and settles the payment. */
async function boostCurrentCreator(
  page: Page,
  request: import("@playwright/test").APIRequestContext,
  options: { readonly name?: string; readonly message?: string; readonly anonymous?: boolean },
) {
  await page.getByTestId("boost-amount-500").click();
  await page.getByTestId("boost-details-toggle").click();
  if (options.name !== undefined) {
    await page.getByTestId("boost-supporter-name").fill(options.name);
  }
  if (options.message !== undefined) {
    await page.getByTestId("boost-supporter-message").fill(options.message);
  }
  if (options.anonymous === true) {
    await page.getByTestId("boost-anonymous").check();
  }
  await page.getByTestId("boost-submit").click();
  await expect(page).toHaveURL(/\/impulsionar\//);

  const paymentId = page.url().split("/").pop() ?? "";
  await settlePayment(request, await providerPaymentIdOf(request, paymentId));
}

test.describe("the supporter wall", () => {
  test("starts empty and invites the first supporter", async ({ page }) => {
    const slug = await createApprovedCreator(page);
    await page.goto(`/criador/${slug}`);

    await expect(page.getByTestId("supporter-wall")).toBeVisible();
    await expect(page.getByTestId("supporter-wall-empty")).toBeVisible();
    await expect(page.getByTestId("supporter-entry")).toHaveCount(0);
  });

  test("adds a supporter as soon as their payment confirms", async ({ page, request }) => {
    const slug = await createApprovedCreator(page);
    const name = unique("Torcedora");

    await page.goto(`/criador/${slug}`);
    await boostCurrentCreator(page, request, { name, message: "bora!" });

    await page.goto(`/criador/${slug}`);
    const entry = page.getByTestId("supporter-entry");
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText(name);
    await expect(entry).toContainText("bora!");
    await expect(entry).toContainText("R$5");
    expect(await entry.getAttribute("data-anonymous")).toBe("false");
    await expect(page.getByText("1 pessoa na torcida")).toBeVisible();
  });

  test("shows an anonymous supporter as Anônimo and never by name", async ({ page, request }) => {
    const slug = await createApprovedCreator(page);
    const name = unique("Escondida");

    await page.goto(`/criador/${slug}`);
    await boostCurrentCreator(page, request, { name, anonymous: true });

    const response = await page.goto(`/criador/${slug}`);
    const entry = page.getByTestId("supporter-entry");
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText("Anônimo");
    expect(await entry.getAttribute("data-anonymous")).toBe("true");
    // The money counts, the name does not reach the page at all.
    await expect(entry).toContainText("R$5");
    expect((await response?.text()) ?? "").not.toContain(name);
  });

  test("does not put a pending boost on the wall", async ({ page }) => {
    const slug = await createApprovedCreator(page);
    const name = unique("Pendente");

    await page.goto(`/criador/${slug}`);
    await page.getByTestId("boost-amount-500").click();
    await page.getByTestId("boost-details-toggle").click();
    await page.getByTestId("boost-supporter-name").fill(name);
    await page.getByTestId("boost-submit").click();
    await expect(page).toHaveURL(/\/impulsionar\//);

    await page.goto(`/criador/${slug}`);
    await expect(page.getByTestId("supporter-wall-empty")).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test("carries no private supporter field into the page source", async ({ page, request }) => {
    const slug = await createApprovedCreator(page);
    await page.goto(`/criador/${slug}`);
    await boostCurrentCreator(page, request, { name: unique("Publica") });

    const response = await page.goto(`/criador/${slug}`);
    const body = (await response?.text()) ?? "";
    for (const secret of ["fanIdentityKey", "supporterEmail", "providerPaymentId"]) {
      expect(body, secret).not.toContain(secret);
    }
  });
});
