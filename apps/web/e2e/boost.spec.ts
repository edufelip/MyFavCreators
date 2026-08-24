import { expect, test } from "@playwright/test";

const DISCLOSURE =
  "Você está comprando destaque nesta plataforma. Nenhum valor é repassado ao criador.";
const RANK_QUOTE_NOTE =
  "Valor calculado com base no ranking atual. A posição pode mudar antes da confirmação do PIX.";
const API_ORIGIN = process.env["API_ORIGIN"] ?? "http://localhost:3001";

/** Drives the fake provider's back office the way a real provider would settle. */
async function settlePayment(
  request: import("@playwright/test").APIRequestContext,
  providerPaymentId: string,
  status: string,
) {
  const response = await request.post(`${API_ORIGIN}/dev/pix/${providerPaymentId}/${status}`);
  expect(response.ok()).toBe(true);
  return response.json();
}

test.describe("the mandatory disclosure", () => {
  test("appears on the homepage boost form", async ({ page }) => {
    await page.goto("/");
    const disclosure = page.getByTestId("boost-disclosure").first();
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toHaveText(DISCLOSURE);
  });

  test("appears in the creator page boost area", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("creator-profile-link").first().click();
    const disclosure = page.getByTestId("boost-disclosure").first();
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toHaveText(DISCLOSURE);
  });

  test("appears on the public rules page", async ({ page }) => {
    await page.goto("/regras");
    const disclosure = page.getByTestId("boost-disclosure").first();
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toHaveText(DISCLOSURE);
  });

  test("appears on the PIX checkout screen", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("boost-amount-500").click();
    await page.getByTestId("boost-submit").click();
    await expect(page).toHaveURL(/\/impulsionar\//);
    const disclosure = page.getByTestId("boost-disclosure").first();
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toHaveText(DISCLOSURE);
  });

  test("is never hidden, collapsed or reduced to fine print", async ({ page }) => {
    for (const path of ["/", "/regras"]) {
      await page.goto(path);
      const disclosure = page.getByTestId("boost-disclosure").first();
      await expect(disclosure, path).toBeVisible();
      const styles = await disclosure.evaluate((element) => {
        const computed = window.getComputedStyle(element);
        return {
          display: computed.display,
          visibility: computed.visibility,
          opacity: Number.parseFloat(computed.opacity),
          fontSize: Number.parseFloat(computed.fontSize),
        };
      });
      expect(styles.display, path).not.toBe("none");
      expect(styles.visibility, path).toBe("visible");
      expect(styles.opacity, path).toBeGreaterThan(0.8);
      expect(styles.fontSize, path).toBeGreaterThanOrEqual(12);
      expect(await disclosure.getAttribute("hidden"), path).toBeNull();
      expect(await disclosure.getAttribute("aria-hidden"), path).toBeNull();
    }
  });
});

test.describe("the rank quote disclosure", () => {
  test("is absent for the leader, who has no rank to take", async ({ page }) => {
    await page.goto("/");
    // The form opens on the current #1, for whom the quote is hidden entirely.
    await expect(page.getByTestId("boost-take-first-place")).toHaveCount(0);
    await expect(page.getByTestId("rank-quote-disclosure")).toHaveCount(0);
  });

  test("appears only when checkout came from Assuma o #1", async ({ page }) => {
    await page.goto("/");
    await selectChallenger(page);

    // A plain amount does not quote a rank, so the note stays away.
    await page.getByTestId("boost-amount-500").click();
    await expect(page.getByTestId("rank-quote-disclosure")).toHaveCount(0);

    // Choosing the quote is what makes the note mandatory.
    await page.getByTestId("boost-take-first-place").click();
    await expect(page.getByTestId("rank-quote-disclosure")).toHaveText(RANK_QUOTE_NOTE);
  });

  test("carries through to the checkout screen", async ({ page }) => {
    await page.goto("/");
    await selectChallenger(page);
    await page.getByTestId("boost-take-first-place").click();
    await page.getByTestId("boost-submit").click();
    await expect(page).toHaveURL(/\/impulsionar\//);
    await expect(page.getByTestId("rank-quote-disclosure")).toHaveText(RANK_QUOTE_NOTE);
  });
});

/**
 * Selects a creator who is not #1.
 *
 * The form opens on the leader, and the Take #1 quote is deliberately hidden for
 * whoever already holds the top spot.
 */
async function selectChallenger(page: import("@playwright/test").Page) {
  const select = page.getByTestId("boost-creator-select");
  const values = await select
    .locator("option")
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(values.length).toBeGreaterThan(1);
  await select.selectOption(values[1] ?? "");
  await expect(page.getByTestId("boost-take-first-place")).toBeVisible();
}

test.describe("the fake PIX journey", () => {
  test("a confirmed payment activates exactly one boost and moves the ranking", async ({
    page,
    request,
  }) => {
    // A creator well down the leaderboard, so a small boost produces a visible
    // and predictable movement.
    await page.goto("/");
    const cards = page.getByTestId("creator-card");
    const lastCard = cards.last();
    const profileHref = await lastCard.getByTestId("creator-profile-link").getAttribute("href");
    expect(profileHref).not.toBeNull();

    await page.goto(profileHref ?? "/");
    const amountBefore = await page.getByTestId("creator-weekly-amount").innerText();

    await page.getByTestId("boost-amount-2500").click();
    await page.getByTestId("boost-submit").click();
    await expect(page).toHaveURL(/\/impulsionar\//);

    // The checkout shows a real PIX payload and waits for the provider.
    await expect(page.getByTestId("checkout-qr")).toBeVisible();
    const copyPaste = await page.getByTestId("checkout-copy-paste").innerText();
    expect(copyPaste.length).toBeGreaterThan(20);
    await expect(page.getByTestId("checkout-waiting")).toBeVisible();

    // The payload must not carry the provider's payment identifier.
    expect(copyPaste).not.toContain("fake_");

    const paymentId = page.url().split("/").pop() ?? "";
    const providerPaymentId = await providerPaymentIdOf(request, paymentId);
    await settlePayment(request, providerPaymentId, "CONFIRMED");

    // The screen notices on its own, without a reload.
    await expect(page.getByTestId("boost-success")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("boost-movement")).toBeVisible();

    await page.goto(profileHref ?? "/");
    const amountAfter = await page.getByTestId("creator-weekly-amount").innerText();
    expect(amountAfter).not.toBe(amountBefore);
  });

  test("a failed payment never reaches the ranking", async ({ page, request }) => {
    await page.goto("/");
    const profileHref = await page
      .getByTestId("creator-card")
      .last()
      .getByTestId("creator-profile-link")
      .getAttribute("href");
    await page.goto(profileHref ?? "/");
    const amountBefore = await page.getByTestId("creator-weekly-amount").innerText();

    await page.getByTestId("boost-amount-500").click();
    await page.getByTestId("boost-submit").click();
    await expect(page).toHaveURL(/\/impulsionar\//);

    const paymentId = page.url().split("/").pop() ?? "";
    const providerPaymentId = await providerPaymentIdOf(request, paymentId);
    await settlePayment(request, providerPaymentId, "FAILED");

    await expect(page.getByTestId("checkout-settled")).toHaveAttribute("data-status", "FAILED", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("boost-success")).toHaveCount(0);

    await page.goto(profileHref ?? "/");
    expect(await page.getByTestId("creator-weekly-amount").innerText()).toBe(amountBefore);
  });

  test("a repeated provider notification does not double the score", async ({ page, request }) => {
    await page.goto("/");
    const profileHref = await page
      .getByTestId("creator-card")
      .last()
      .getByTestId("creator-profile-link")
      .getAttribute("href");
    await page.goto(profileHref ?? "/");

    await page.getByTestId("boost-amount-1000").click();
    await page.getByTestId("boost-submit").click();
    await expect(page).toHaveURL(/\/impulsionar\//);

    const paymentId = page.url().split("/").pop() ?? "";
    const providerPaymentId = await providerPaymentIdOf(request, paymentId);
    await settlePayment(request, providerPaymentId, "CONFIRMED");
    await expect(page.getByTestId("boost-success")).toBeVisible({ timeout: 15_000 });

    await page.goto(profileHref ?? "/");
    const afterOnce = await page.getByTestId("creator-weekly-amount").innerText();

    // The provider re-delivers the same notification several times.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await settlePayment(request, providerPaymentId, "CONFIRMED");
    }

    await page.goto(profileHref ?? "/");
    expect(await page.getByTestId("creator-weekly-amount").innerText()).toBe(afterOnce);
  });
});

/**
 * Looks up the provider payment id for a payment.
 *
 * Only the simulation surface exposes it, and only outside production, which is
 * exactly the point: no public payload carries it.
 */
async function providerPaymentIdOf(
  request: import("@playwright/test").APIRequestContext,
  paymentId: string,
): Promise<string> {
  const response = await request.get(`${API_ORIGIN}/dev/pix/lookup/${paymentId}`);
  expect(response.ok(), "the development lookup route must be mounted").toBe(true);
  const body = (await response.json()) as { providerPaymentId: string };
  return body.providerPaymentId;
}
