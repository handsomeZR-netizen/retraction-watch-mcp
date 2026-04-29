import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.RW_WEB_E2E_PORT ?? 3212);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const e2eRoot =
  process.env.RW_WEB_E2E_ROOT ?? path.join(os.tmpdir(), `rw-web-e2e-${process.pid}`);

cleanupOldE2ERoots();
process.env.RW_WEB_E2E_ROOT = e2eRoot;

const e2eEnv: Record<string, string> = {
  ...process.env,
  RW_APP_DB_DIR: path.join(e2eRoot, "db"),
  RW_SCREEN_CONFIG_DIR: path.join(e2eRoot, "config"),
  RW_SCREEN_DATA_DIR: path.join(e2eRoot, "manuscripts"),
  RW_DATA_KEY: "a".repeat(64),
  RW_SESSION_SECRET: "codex-e2e-session-secret-32-bytes-minimum-value",
};

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEB_SERVER
    ? undefined
    : {
        command: `npx next dev -p ${port}`,
        env: e2eEnv,
        reuseExistingServer: false,
        timeout: 120_000,
        url: `${baseURL}/api/health`,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

function cleanupOldE2ERoots(): void {
  const tmp = os.tmpdir();
  const cutoff = Date.now() - 60 * 60_000;
  for (const entry of fs.readdirSync(tmp, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("rw-web-e2e-")) continue;
    const fullPath = path.join(tmp, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs < cutoff) {
        fs.rmSync(fullPath, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      }
    } catch {
      /* best effort */
    }
  }
}
