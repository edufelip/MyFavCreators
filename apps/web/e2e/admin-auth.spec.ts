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
