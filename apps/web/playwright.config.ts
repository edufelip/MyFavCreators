import { defineConfig, devices } from "@playwright/test";

const WEB_ORIGIN = process.env["WEB_ORIGIN"] ?? "http://localhost:3000";
const API_ORIGIN = process.env["API_ORIGIN"] ?? "http://localhost:3001";
const ADMIN_ORIGIN = process.env["ADMIN_ORIGIN"] ?? "http://localhost:3002";
const isCi = process.env["CI"] !== undefined;
/**
 * Escape hatch for environments that already ship a Chromium build (containers,
 * air-gapped runners). CI installs the browser Playwright pins instead.
 */
const chromiumExecutable = process.env["PLAYWRIGHT_CHROMIUM_EXECUTABLE"];

/**
 * Playwright is a Node-only tool and runs on the pinned Node 24 LTS release.
 *
 * The smoke suite drives the real stack: the Elysia API against PostgreSQL and
 * the built Next.js app, never a mock.
 */
export default defineConfig({
  testDir: "./e2e",
  /**
   * Tests inside one file run in order, files run in parallel.
   *
   * The suite drives the real stack against one shared database, and the ranking
   * is global state: two tests boosting the same creator at once read each
   * other's money and fail on an assertion that has nothing to do with the code
   * under test. Files stay isolated from each other because each creates the
   * creators it touches, so parallelism is kept where it is actually safe.
   */
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  /*
   * One worker, locally as well as in CI.
   *
   * The suite drives one stack against one database, and two things in it are
   * genuinely global: the ranking, and the administrator's second factor. A
   * TOTP code may be used once, so two workers signing in inside the same
   * thirty-second window make each other fail — a flake with nothing to do with
   * the code under test. Running the files in order costs about a minute and
   * makes a local run mean the same thing a CI run means.
   */
  workers: 1,
  reporter: isCi ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: WEB_ORIGIN,
    trace: "on-first-retry",
  },
  projects: [
    // Mobile web is the primary experience, so that is what the smoke suite drives.
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
        ...(chromiumExecutable === undefined
          ? {}
          : { launchOptions: { executablePath: chromiumExecutable } }),
      },
    },
  ],
  webServer: [
    {
      command: "bun run ../api/src/index.ts",
      url: `${API_ORIGIN}/health`,
      reuseExistingServer: !isCi,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "bun run start",
      url: WEB_ORIGIN,
      reuseExistingServer: !isCi,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "bun run --cwd ../admin start",
      url: `${ADMIN_ORIGIN}/login`,
      reuseExistingServer: !isCi,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
