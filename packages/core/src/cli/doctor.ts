#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { DB_PATH_ENV, DATA_DIR_ENV, resolveDbPath } from "../config.js";
import { RetractionWatchRepository } from "../data/repository.js";
import { loadPolicy, policyMetadata } from "../policy.js";
import { getArg, hasFlag, parseArgs } from "./args.js";

const require = createRequire(import.meta.url);

interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
  details?: Record<string, unknown>;
}

const args = parseArgs(process.argv.slice(2));

if (hasFlag(args, "help")) {
  printHelp();
  process.exit(0);
}

const checks: DoctorCheck[] = [];
const dbPath = resolveDbPath(getArg(args, "db-path"));

checks.push(checkNodeVersion());
await checkPolicy(checks);
checkSqlite(checks);
await checkDatabase(checks, dbPath);

const hasFailures = checks.some((check) => check.status === "fail");

if (hasFlag(args, "json")) {
  console.log(
    JSON.stringify(
      {
        ok: !hasFailures,
        dbPath,
        env: {
          [DB_PATH_ENV]: process.env[DB_PATH_ENV] ?? null,
          [DATA_DIR_ENV]: process.env[DATA_DIR_ENV] ?? null,
        },
        checks,
      },
      null,
      2,
    ),
  );
} else {
  console.log("Retraction Watch MCP doctor\n");
  console.log(`Database: ${dbPath}`);
  console.log(`RW_MCP_DB_PATH: ${process.env[DB_PATH_ENV] ?? "(not set)"}`);
  console.log(`RW_MCP_DATA_DIR: ${process.env[DATA_DIR_ENV] ?? "(not set)"}`);
  console.log("");
  for (const check of checks) {
    console.log(`${symbolFor(check.status)} ${check.name}: ${check.message}`);
  }
}

process.exitCode = hasFailures ? 1 : 0;

function checkNodeVersion(): DoctorCheck {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) {
    return {
      name: "node",
      status: "ok",
      message: `Node.js ${process.versions.node}`,
    };
  }
  return {
    name: "node",
    status: "fail",
    message: `Node.js ${process.versions.node}; Node.js >=20 is required.`,
  };
}

async function checkPolicy(checksToUpdate: DoctorCheck[]): Promise<void> {
  try {
    const policy = await loadPolicy(getArg(args, "policy"), hasFlag(args, "strict"));
    checksToUpdate.push({
      name: "policy",
      status: "ok",
      message: `${policy.policyVersion} (${policy.mode})`,
      details: policyMetadata(policy),
    });
  } catch (error) {
    checksToUpdate.push({
      name: "policy",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function checkSqlite(checksToUpdate: DoctorCheck[]): void {
  try {
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const db = new Database(":memory:");
    db.close();
    checksToUpdate.push({
      name: "better-sqlite3",
      status: "ok",
      message: "Native SQLite runtime loaded.",
    });
  } catch (error) {
    checksToUpdate.push({
      name: "better-sqlite3",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function checkDatabase(checksToUpdate: DoctorCheck[], resolvedDbPath: string): Promise<void> {
  try {
    const stat = await fs.stat(resolvedDbPath);
    checksToUpdate.push({
      name: "database-file",
      status: "ok",
      message: `${formatBytes(stat.size)} at ${resolvedDbPath}`,
      details: {
        absolutePath: path.resolve(resolvedDbPath),
        bytes: stat.size,
      },
    });
  } catch {
    checksToUpdate.push({
      name: "database-file",
      status: "fail",
      message: `Database not found. Run "rw-import" or pass --db-path.`,
      details: {
        absolutePath: path.resolve(resolvedDbPath),
      },
    });
    return;
  }

  let repository: RetractionWatchRepository | null = null;
  try {
    repository = await RetractionWatchRepository.open(resolvedDbPath);
    const snapshot = repository.getSourceSnapshot();
    if (!snapshot) {
      checksToUpdate.push({
        name: "source-snapshot",
        status: "warn",
        message: "Database opened, but no source snapshot row was found.",
      });
      return;
    }
    checksToUpdate.push({
      name: "source-snapshot",
      status: "ok",
      message: `${snapshot.rowCount} rows; generated ${snapshot.generatedOn ?? "unknown"}; imported ${snapshot.importedAt}`,
      details: {
        csvSha256: snapshot.csvSha256,
        sourceCommit: snapshot.sourceCommit,
        policyVersion: snapshot.policyVersion,
      },
    });
  } catch (error) {
    checksToUpdate.push({
      name: "database-open",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    repository?.close();
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === "GB") {
      return `${value.toFixed(1)} ${unit}`;
    }
    value /= 1024;
  }
  return `${bytes} B`;
}

function symbolFor(status: DoctorCheck["status"]): string {
  if (status === "ok") return "[OK]";
  if (status === "warn") return "[WARN]";
  return "[FAIL]";
}

function printHelp(): void {
  console.log(`Usage: rw-doctor [options]

Check the local Retraction Watch MCP runtime, database, source snapshot, and match policy.

Options:
  --db-path <path>   SQLite database path.
  --policy <value>   Policy name (balanced, strict) or path to a policy JSON file.
  --strict           Shortcut for --policy strict.
  --json             Print machine-readable JSON.
  --help             Show this help message.
`);
}
