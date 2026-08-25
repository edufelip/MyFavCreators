import { expect, test } from "@playwright/test";
import {
  ADMIN_ORIGIN,
  currentTotpCode,
  fillLoginForm,
  markStepSpent,
  signInToAdmin,
} from "./support/admin";

/**
 * Who gets into the administration app.
 *
 * A single shared password used to be the whole authentication surface, and
 * every action it authorised was filed under "admin". Two factors now, per
 * person, and the name goes into the audit log.
 */
test.describe("signing in", () => {
  test("needs the name, the password and the code together", async ({ page }) => {
    await fillLoginForm(page, { password: "senha-errada" });
    await expect(page.getByTestId("login-error")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await fillLoginForm(page, { code: "000000" });
    await expect(page.getByTestId("login-error")).toBeVisible();

    await fillLoginForm(page, { operator: "ninguem" });
    await expect(page.getByTestId("login-error")).toBeVisible();

    // None of that created a session.
    await page.goto(`${ADMIN_ORIGIN}/moderacao`);
    await expect(page).toHaveURL(/\/login/);
  });

  test("says the same thing whichever part was wrong", async ({ page }) => {
    /*
     * Telling somebody "that operator exists but the password is wrong" is free
     * reconnaissance. All three failures read identically.
     */
    await fillLoginForm(page, { password: "senha-errada" });
    const wrongPassword = await page.getByTestId("login-error").textContent();

    await fillLoginForm(page, { operator: "ninguem" });
    const unknownOperator = await page.getByTestId("login-error").textContent();

    expect(wrongPassword).toBe(unknownOperator);
  });

  test("refuses a code that has already been used", async ({ page, context }) => {
    const step = await fillLoginForm(page);
    await expect(page).toHaveURL(/\/moderacao/);
    markStepSpent(step);
    const code = currentTotpCode();

    // Same code, same window, fresh browser: a code lifted from a log or read
    // over a shoulder is worth nothing once it has been spent.
    await context.clearCookies();
    await fillLoginForm(page, { code });
    await expect(page.getByTestId("login-error")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("shows who is signed in", async ({ page }) => {
    await signInToAdmin(page);
    await expect(page.getByTestId("admin-operator")).toHaveText(
      process.env["E2E_ADMIN_OPERATOR"] ?? "edu",
    );
  });

  test("the current code alone opens nothing without the password", async ({ page }) => {
    await fillLoginForm(page, { password: "", code: currentTotpCode() });
    await expect(page).toHaveURL(/\/login/);
  });
});

const API_ORIGIN = process.env["API_ORIGIN"] ?? "http://localhost:3001";

/**
 * A paid, live boost — the ordinary thing an operator is asked to undo.
 *
 * Driven through the real public flow rather than seeded, because the point of
 * the test below is the whole chain: the admin form, the admin server, the
 * internal API surface, the provider, and the record. A seeded row would skip
 * exactly the hop that has historically been wrong.
 */
async function confirmedBoost(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
) {
  const handle = `refunde2e${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

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

  await page.goto(`/criador/${slug}`);
  await page.getByTestId("boost-amount-2500").click();
  await page.getByTestId("boost-submit").click();
  await expect(page).toHaveURL(/\/impulsionar\//);
  const paymentId = page.url().split("/").pop() ?? "";

  const lookup = await request.get(`${API_ORIGIN}/dev/pix/lookup/${paymentId}`);
  expect(lookup.ok(), "the development lookup route must be mounted").toBe(true);
  const body: unknown = await lookup.json();
  const providerPaymentId =
    typeof body === "object" && body !== null && "providerPaymentId" in body
      ? String(body.providerPaymentId)
      : "";

  const settled = await request.post(`${API_ORIGIN}/dev/pix/${providerPaymentId}/CONFIRMED`);
  expect(settled.ok()).toBe(true);
  await expect(page.getByTestId("boost-success")).toBeVisible({ timeout: 15_000 });

  return { paymentId, slug: slug ?? "" };
}

test.describe("sending money back", () => {
  test("an operator refunds a payment, and the record says so", async ({ page, request }) => {
    const { paymentId } = await confirmedBoost(page, request);

    await signInToAdmin(page);
    await page.goto(`${ADMIN_ORIGIN}/pagamentos?status=CONFIRMED`);

    const row = page.getByTestId("payment-row").filter({ hasText: "CONFIRMED" }).first();
    await expect(row).toBeVisible();
    await row.getByTestId("refund-open").click();
    await row.getByTestId("refund-reason").fill("PIX duplicado confirmado pelo suporte");
    await row.getByTestId("refund-confirm").click();

    /*
     * The whole chain, not a seeded row: the admin form, the admin server, the
     * internal API surface, the provider, and the record. A refund that only
     * looked like it worked is the exact failure this covers — and the shape of
     * a request between two apps that never type-check against each other is
     * where this repository has been wrong before.
     */
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`${ADMIN_ORIGIN}/pagamentos?status=REFUNDED`);
          return (await response.text()).includes(paymentId.slice(0, 8)) ? "listed" : "missing";
        },
        { timeout: 20_000 },
      )
      .toBe("listed");
  });

  test("the refund is recorded against the operator who ordered it", async ({ page, request }) => {
    await confirmedBoost(page, request);

    await signInToAdmin(page);
    await page.goto(`${ADMIN_ORIGIN}/pagamentos?status=CONFIRMED`);
    const row = page.getByTestId("payment-row").first();
    await row.getByTestId("refund-open").click();
    await row.getByTestId("refund-reason").fill("estorno registrado no suporte");
    await row.getByTestId("refund-confirm").click();

    await page.goto(`${ADMIN_ORIGIN}/auditoria`);
    const entry = page.getByTestId("audit-row").filter({ hasText: "payment.refunded_by_operator" });
    await expect(entry.first()).toBeVisible();
    await expect(entry.first()).toContainText(process.env["E2E_ADMIN_OPERATOR"] ?? "edu");
  });
});

test.describe("the payments view", () => {
  test("lists payments and names the operator who is looking", async ({ page }) => {
    await signInToAdmin(page);
    await page.goto(`${ADMIN_ORIGIN}/pagamentos`);

    await expect(page.getByRole("heading", { name: "Pagamentos" })).toBeVisible();
    await expect(page.getByTestId("admin-operator")).toBeVisible();
  });

  test("says plainly that a refund never reaches the creator", async ({ page }) => {
    await signInToAdmin(page);
    await page.goto(`${ADMIN_ORIGIN}/pagamentos`);
    await expect(page.getByText("Nenhum valor é repassado ao criador")).toBeVisible();
  });

  test("is closed to somebody with no session", async ({ page }) => {
    await page.goto(`${ADMIN_ORIGIN}/pagamentos`);
    await expect(page).toHaveURL(/\/login/);
  });
});
