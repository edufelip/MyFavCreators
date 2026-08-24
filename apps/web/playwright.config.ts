import { defineConfig, devices } from "@playwright/test";

const WEB_ORIGIN = process.env["WEB_ORIGIN"] ?? "http://localhost:3000";
const API_ORIGIN = process.env["API_ORIGIN"] ?? "http://localhost:3001";
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
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  workers: isCi ? 1 : undefined,
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
  ],
});
