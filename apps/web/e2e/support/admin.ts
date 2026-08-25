import { totpCodeAt, totpStep } from "@creator-outdoor/config";
import { expect, type Page } from "@playwright/test";

/**
 * Signing into the administration app from the smoke suite.
 *
 * The real form is driven at least once per worker, second factor included, so
 * the login path is genuinely exercised. After that the session cookie is
 * reused: a TOTP code may be spent only once, and signing in six times inside
 * one thirty-second window would otherwise mean waiting out the clock between
 * tests to prove something the first sign-in already proved.
 */
export const ADMIN_ORIGIN = process.env["ADMIN_ORIGIN"] ?? "http://localhost:3002";

const OPERATOR = process.env["E2E_ADMIN_OPERATOR"] ?? "edu";
const PASSWORD = process.env["E2E_ADMIN_PASSWORD"] ?? "creator-outdoor-dev";
const TOTP_SECRET = process.env["E2E_ADMIN_TOTP_SECRET"] ?? "";

type Cookies =
  Awaited<ReturnType<Page["context"]>["storageState"]> extends Promise<infer TState>
    ? TState extends { cookies: infer TCookies }
      ? TCookies
      : never
    : never;

let session: Cookies | null = null;

/**
 * Steps this worker has spent on a *successful* sign-in.
 *
 * A failed attempt does not spend anything — the server only marks a code used
 * once it has accepted it — so a wrong-password test does not cost the next
 * test a thirty-second wait.
 */
const spentSteps = new Set<number>();

/**
 * A step nobody has signed in with yet, waiting out the window if necessary.
 *
 * The server refuses a replayed code, which is the point — so the suite has to
 * respect the same rule rather than work around it.
 */
async function usableStep(): Promise<number> {
  let step = totpStep();
  while (spentSteps.has(step)) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    step = totpStep();
  }
  return step;
}

/** The code for the current step, spent or not. For testing replay itself. */
export function currentTotpCode(): string {
  return totpCodeAt(TOTP_SECRET, totpStep());
}

/** Fills and submits the login form. Returns the TOTP step it used. */
export async function fillLoginForm(
  page: Page,
  credentials: {
    readonly operator?: string;
    readonly password?: string;
    readonly code?: string;
  } = {},
): Promise<number> {
  // Only a code this helper generates has to be unspent; a caller supplying one
  // is usually testing what happens to a bad or replayed code, and waiting out
  // the window for it would just make the suite slower.
  const step = credentials.code === undefined ? await usableStep() : totpStep();
  await page.goto(`${ADMIN_ORIGIN}/login`);
  await page.getByLabel("Operador").fill(credentials.operator ?? OPERATOR);
  await page.getByLabel("Senha").fill(credentials.password ?? PASSWORD);
  await page
    .getByLabel("Código do autenticador")
    .fill(credentials.code ?? totpCodeAt(TOTP_SECRET, step));
  await page.getByRole("button", { name: "Entrar" }).click();
  return step;
}

/** Marks a step as spent, so no later sign-in offers the same code. */
export function markStepSpent(step: number): void {
  spentSteps.add(step);
}

export async function signInToAdmin(page: Page): Promise<void> {
  if (session !== null) {
    await page.context().addCookies(session);
    await page.goto(`${ADMIN_ORIGIN}/moderacao`);
    await expect(page).toHaveURL(/\/moderacao/);
    return;
  }

  /*
   * Retried across TOTP windows, because a spent code is refused and the spec
   * files run in parallel workers that cannot see each other's spent steps.
   * Two workers reaching the login form inside the same thirty seconds is
   * ordinary, and the second one simply waits for the next code — the same
   * thing a person would do.
   */
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const step = await fillLoginForm(page);
    if (
      await page.waitForURL(/\/moderacao/, { timeout: 5_000 }).then(
        () => true,
        () => false,
      )
    ) {
      markStepSpent(step);
      session = (await page.context().storageState()).cookies;
      return;
    }
    markStepSpent(step);
  }

  await expect(page, "signing into the admin app").toHaveURL(/\/moderacao/);
}
