import { expect, test } from "@playwright/test";
import { affirmativeUses } from "../src/lib/forbidden-copy";
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
 * One rule for every page, `/regras` included.
 *
 * There used to be two: a plain "the word must not appear" scan everywhere, and
 * a "the word may appear, but only inside a denial" scan on `/regras`. That
 * split stopped being tenable the moment the terms became stems, because the
 * *mandatory disclosure* — "Nenhum valor é repassado ao criador" — contains
 * `repass`, and it is required verbatim on four surfaces.
 *
 * The denial rule is the right one anyway, and always was. The specification
 * bans claiming these things, not uttering the words; the plain scan only
 * looked equivalent while no required sentence happened to contain one. It is
 * also the stricter rule where it matters: a plain scan cannot tell "não é
 * vaquinha" from "é uma vaquinha", so it had to be waived exactly where the
 * words appear — and that waiver is how an affirmative "sorteio de exibição"
 * lived on `/regras`.
 */
const PUBLIC_PAGES = [
  "/",
  "/enviar",
  "/hall-da-fama",
  "/gerenciar",
  "/descadastrar/aaaaaaaaaaaaaaaa",
];

test.describe("what the platform says", () => {
  for (const path of [...PUBLIC_PAGES, "/regras"]) {
    test(`${path} never implies a payout, a donation or a game of chance`, async ({ page }) => {
      await page.goto(path);
      const uses = affirmativeUses(await platformText(page));
      expect(uses.map((use) => `${use.term}: ${use.context}`)).toEqual([]);
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

    expect(affirmativeUses(await platformText(page)).map((use) => use.term)).toEqual([]);
  });

  test("a creator page never implies it either", async ({ page }) => {
    await page.goto("/");
    const href = await page
      .getByTestId("creator-card")
      .first()
      .getByTestId("creator-profile-link")
      .getAttribute("href");
    await page.goto(href ?? "/");

    expect(affirmativeUses(await platformText(page)).map((use) => use.term)).toEqual([]);
  });

  test("the checkout screen never implies it either", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("boost-amount-500").click();
    await page.getByTestId("boost-submit").click();
    await expect(page).toHaveURL(/\/impulsionar\//);

    expect(affirmativeUses(await platformText(page)).map((use) => use.term)).toEqual([]);
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
