import { expect, test } from "@playwright/test";

/**
 * Smoke coverage for the public billboard.
 *
 * The assertions are about product mechanics that must not regress: the weekly
 * leader owns the marquee, the ranking is ordered by money, the Take #1 quote
 * is shown to challengers and hidden from the leader, and the weekly countdown
 * is present.
 */
test.describe("public homepage", () => {
  test("shows the hero, the current #1 billboard and the countdown", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "O outdoor das torcidas." })).toBeVisible();
    await expect(
      page.getByText("Impulsione um perfil. Compre destaque. Dispute o topo."),
    ).toBeVisible();

    const billboard = page.getByTestId("billboard");
    await expect(billboard).toBeVisible();
    await expect(billboard.getByText("#1 desta semana")).toBeVisible();
    await expect(billboard.getByRole("heading", { level: 1 })).not.toBeEmpty();

    await expect(page.getByTestId("countdown")).toContainText("O ranking semanal zera em");
  });

  test("ranks creators by money, highest first", async ({ page }) => {
    await page.goto("/");

    const cards = page.getByTestId("creator-card");
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    expect(count).toBeGreaterThan(1);

    const amounts: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const text = (await cards.nth(index).innerText()).replace(/\s+/g, " ");
      const match = /R\$([\d.]+)(?:,(\d{2}))? impulsionados/.exec(text);
      expect(match, `card ${index} shows an amount`).not.toBeNull();
      const reais = Number.parseInt((match?.[1] ?? "0").replace(/\./g, ""), 10);
      const centavos = Number.parseInt(match?.[2] ?? "0", 10);
      amounts.push(reais * 100 + centavos);
      await expect(cards.nth(index)).toContainText(`#${index + 1}`);
    }

    const sorted = [...amounts].sort((a, b) => b - a);
    expect(amounts).toEqual(sorted);
  });

  test("hides Take #1 for the leader and quotes it for a challenger", async ({ page }) => {
    await page.goto("/");

    const cards = page.getByTestId("creator-card");
    await expect(cards.first()).toBeVisible();
    await expect(cards.first().getByTestId("take-first-place")).toHaveCount(0);

    const challengerQuote = cards.nth(1).getByTestId("take-first-place");
    await expect(challengerQuote).toBeVisible();
    await expect(challengerQuote).toContainText(/^Assuma o #1 por R\$[\d.,]+$/);
  });

  test("keeps the weekly leader on the marquee while showing the general ranking", async ({
    page,
  }) => {
    await page.goto("/");
    const weeklyLeader = await page
      .getByTestId("billboard")
      .getByRole("heading", { level: 1 })
      .innerText();

    await page.getByRole("tab", { name: "Geral" }).click();
    await expect(page.getByRole("tab", { name: "Geral" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("creator-card").first()).toContainText("impulsionados no total");
    await expect(page.getByTestId("billboard").getByRole("heading", { level: 1 })).toHaveText(
      weeklyLeader,
    );
  });

  test("never leaks a private supporter field into the public page", async ({ page }) => {
    const response = await page.goto("/");
    const body = (await response?.text()) ?? "";
    for (const secret of [
      "fanIdentityKey",
      "supporterEmail",
      "providerPaymentId",
      "moderationStatus",
      "normalizedKey",
    ]) {
      expect(body, secret).not.toContain(secret);
    }
  });
});
