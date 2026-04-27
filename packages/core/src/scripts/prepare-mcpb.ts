#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const corePackageDir = path.resolve(here, "..", "..");
const repoRoot = path.resolve(corePackageDir, "..", "..");
const bundleDir = path.join(repoRoot, "mcpb", "build", "retraction-watch-mcp");
const serverDir = path.join(bundleDir, "server");
const skipInstall = process.argv.includes("--skip-install");

await fs.rm(bundleDir, { recursive: true, force: true });
await fs.mkdir(serverDir, { recursive: true });

await copyDir(path.join(corePackageDir, "dist"), serverDir);
await copyFile(
  path.join(repoRoot, "mcpb", "manifest.json"),
  path.join(bundleDir, "manifest.json"),
);
await copyFile(path.join(repoRoot, "README.md"), path.join(bundleDir, "README.md"));
await copyFile(path.join(repoRoot, "LICENSE"), path.join(bundleDir, "LICENSE"));
await copyDir(path.join(corePackageDir, "policies"), path.join(bundleDir, "policies"));

const packageJson = JSON.parse(
  await fs.readFile(path.join(corePackageDir, "package.json"), "utf8"),
) as {
  name: string;
  version: string;
  type?: string;
  dependencies?: Record<string, string>;
  engines?: Record<string, string>;
};

await fs.writeFile(
  path.join(bundleDir, "package.json"),
  JSON.stringify(
    {
      name: packageJson.name,
      version: packageJson.version,
      type: packageJson.type,
      private: true,
      dependencies: packageJson.dependencies,
      engines: packageJson.engines,
    },
    null,
    2,
  ),
);

if (!skipInstall) {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const installArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "npm install --omit=dev --ignore-scripts"]
      : ["install", "--omit=dev", "--ignore-scripts"];
  const result = spawnSync(command, installArgs, {
    cwd: bundleDir,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error("npm install --omit=dev failed while preparing MCPB bundle.");
  }
}

console.log(`MCPB staging directory ready: ${bundleDir}`);
console.log(`Pack it with: npx -y @anthropic-ai/mcpb pack "${bundleDir}"`);

async function copyFile(from: string, to: string): Promise<void> {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

async function copyDir(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(from, entry.name);
    const targetPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
  }
}
