import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.join(appDir, ".next", "build-runtime");
const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

// session.ts and crypto/data-key.ts resolve secrets at module load and throw
// in production when they are missing. Next 15's collect-page-data phase
// loads every route module under NODE_ENV=production, so a fresh `next build`
// without secrets in the env crashes before any user code runs. Inject
// throwaway placeholders for the build only — at runtime, docker-compose
// (or whatever orchestrator) will supply the real values via env_file/.env.
const BUILD_TIME_PLACEHOLDER_SECRET =
  "build-time-placeholder-not-used-at-runtime-do-not-deploy-this-32b";
const BUILD_TIME_PLACEHOLDER_DATA_KEY = "0".repeat(64); // 64 hex chars
const env = {
  ...process.env,
  RW_APP_DB_DIR: process.env.RW_APP_DB_DIR ?? path.join(runtimeRoot, "db"),
  RW_SCREEN_CONFIG_DIR: process.env.RW_SCREEN_CONFIG_DIR ?? path.join(runtimeRoot, "config"),
  RW_SCREEN_DATA_DIR: process.env.RW_SCREEN_DATA_DIR ?? path.join(runtimeRoot, "manuscripts"),
  RW_SESSION_SECRET: process.env.RW_SESSION_SECRET ?? BUILD_TIME_PLACEHOLDER_SECRET,
  RW_DATA_KEY: process.env.RW_DATA_KEY ?? BUILD_TIME_PLACEHOLDER_DATA_KEY,
};

const child = spawn(process.execPath, [nextBin, "build"], {
  cwd: appDir,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
