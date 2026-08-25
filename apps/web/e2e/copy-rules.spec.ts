import { expect, test } from "@playwright/test";
import { affirmativeUses, forbiddenTerms } from "../src/lib/forbidden-copy";
import { platformText } from "./support/page-text";

/**
 * The copy rules, checked against what a visitor actually sees.
 *
 * The unit test walks the copy bank; this walks the rendered page, which also
 * catches a string hard-coded in a component, one arriving from configuration,
 * or one produced by formatting. Both are needed: neither sees what the other
 * sees.
 */
const DISCLOSURE =
  "Você está comprando destaque nesta plataforma. Nenhum valor é repassado ao criador.";

/*
 * The rule itself lives in `src/lib/forbidden-copy.ts` and has its own unit
 * test, so the sentences that could defeat it are checked directly rather than
 * only through a browser. This spec is what applies it to what a visitor
 * actually sees.
 */

/**
 * `/regras` is deliberately absent from the plain scan: it is the one surface
 * whose job is to name these words and deny them ("não é vaquinha, não é
 * doação"). It gets a stricter test instead — every occurrence must sit inside
 * a denial — because "exempt" was being read as "unchecked", and an affirmative
 * "sorteio de exibição" survived there for exactly that reason.
 */
const PUBLIC_PAGES = [
  "/",
  "/enviar",
  "/hall-da-fama",
  "/gerenciar",
  "/descadastrar/aaaaaaaaaaaaaaaa",
];

test.describe("what the platform says", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} never implies a payout, a donation or a game of chance`, async ({ page }) => {
      await page.goto(path);
      expect(forbiddenTerms(await platformText(page))).toEqual([]);
    });
  }

  test("a category page never implies it either", async ({ page }) => {
    /*
     * In the rendered scan and not only the copy-bank one, because the point of
     * this scan is to catch a string that is *not* in the copy bank — one
     * hard-coded in a component, arriving from configuration, or produced by
     * formatting.
     */
    await page.goto("/");
    const href = await page.getByTestId("creator-category-link").first().getAttribute("href");
    await page.goto(href ?? "/");

    expect(forbiddenTerms(await platformText(page))).toEqual([]);
  });

  test("a creator page never implies it either", async ({ page }) => {
    await page.goto("/");
    const href = await page
      .getByTestId("creator-card")
      .first()
      .getByTestId("creator-profile-link")
      .getAttribute("href");
    await page.goto(href ?? "/");

    expect(forbiddenTerms(await platformText(page))).toEqual([]);
  });

  test("the checkout screen never implies it either", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("boost-amount-500").click();
    await page.getByTestId("boost-submit").click();
    await expect(page).toHaveURL(/\/impulsionar\//);

    expect(forbiddenTerms(await platformText(page))).toEqual([]);
  });

  test("never claims money reaches the creator", async ({ page }) => {
    /*
     * "Repassado" is not banned — the mandatory disclosure contains it. What is
     * banned is saying it without the denial, so every sentence that puts money
     * and a creator together has to carry one.
     */
    for (const path of [...PUBLIC_PAGES, "/regras"]) {
      await page.goto(path);
      const text = (await platformText(page)).toLowerCase();
      for (const match of text.matchAll(/[^.]*repassad[^.]*/g)) {
        expect(match[0], `${path}: ${match[0]}`).toMatch(/nenhum valor|não é repassad/);
      }
      for (const match of text.matchAll(/[^.]*vai para o criador[^.]*/g)) {
        expect(match[0], `${path}: ${match[0]}`).toMatch(/nenhum valor/);
      }
    }
  });

  test("the rules page names each forbidden idea only to deny it", async ({ page }) => {
    await page.goto("/regras");
    const text = (await platformText(page)).toLowerCase();

    // Somebody asking "is this a vaquinha?" has to find the answer here.
    expect(text).toContain("não é vaquinha");
    expect(text).toContain("não é doação");
    expect(text).toContain("não é apoio financeiro");
    expect(text).toContain("nunca entra em sorteio");
    expect(text).toContain("nenhum valor é repassado ao criador");
  });

  test("the rules page never uses a forbidden word affirmatively", async ({ page }) => {
    /*
     * The exemption is "may name them to deny them", not "is unchecked". Every
     * one of these words has to sit next to a denial — without this, `/regras`
     * was the one public page with no copy check at all, and an affirmative
     * "sorteio de exibição" lived there.
     */
    await page.goto("/regras");
    const uses = affirmativeUses(await platformText(page));
    expect(uses.map((use) => `${use.term}: ${use.context}`)).toEqual([]);
  });

  test("carries the disclosure verbatim on every surface that must have it", async ({ page }) => {
    // Homepage boost form, creator page boost area, checkout, public rules.
    await page.goto("/");
    await expect(page.getByTestId("boost-disclosure").first()).toHaveText(DISCLOSURE);

    await page.goto("/regras");
    await expect(page.getByTestId("boost-disclosure").first()).toHaveText(DISCLOSURE);

    const href = await page
      .goto("/")
      .then(async () =>
        page
          .getByTestId("creator-card")
          .first()
          .getByTestId("creator-profile-link")
          .getAttribute("href"),
      );
    await page.goto(href ?? "/");
    await expect(page.getByTestId("boost-disclosure").first()).toHaveText(DISCLOSURE);

    await page.getByTestId("boost-amount-500").click();
    await page.getByTestId("boost-submit").click();
    await expect(page).toHaveURL(/\/impulsionar\//);
    await expect(page.getByTestId("boost-disclosure").first()).toHaveText(DISCLOSURE);
  });
});
