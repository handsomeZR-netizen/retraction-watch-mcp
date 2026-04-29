import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.join(appDir, ".next", "build-runtime");
const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const env = {
  ...process.env,
  RW_APP_DB_DIR: process.env.RW_APP_DB_DIR ?? path.join(runtimeRoot, "db"),
  RW_SCREEN_CONFIG_DIR: process.env.RW_SCREEN_CONFIG_DIR ?? path.join(runtimeRoot, "config"),
  RW_SCREEN_DATA_DIR: process.env.RW_SCREEN_DATA_DIR ?? path.join(runtimeRoot, "manuscripts"),
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
