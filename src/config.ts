import os from "node:os";
import path from "node:path";

export const RW_CSV_URL =
  "https://gitlab.com/crossref/retraction-watch-data/-/raw/main/retraction_watch.csv";

export const RW_README_URL =
  "https://gitlab.com/crossref/retraction-watch-data/-/raw/main/README.md";

export const RW_COMMIT_API_URL =
  "https://gitlab.com/api/v4/projects/61336882/repository/commits/main";

export const POLICY_VERSION = "rw-person-screening-v2";

export const DEFAULT_NOTICE_TYPES = [
  "Retraction",
  "Correction",
  "Expression of concern",
  "Reinstatement",
] as const;

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

export const DATA_DIR_ENV = "RW_MCP_DATA_DIR";
export const DB_PATH_ENV = "RW_MCP_DB_PATH";

export function getDefaultDataDir(): string {
  return path.resolve(process.env[DATA_DIR_ENV] ?? path.join(os.homedir(), ".retraction-watch-mcp"));
}

export function getDefaultDbPath(): string {
  return path.resolve(process.env[DB_PATH_ENV] ?? path.join(getDefaultDataDir(), "retraction-watch.sqlite"));
}

export function resolveDbPath(dbPath?: string): string {
  return path.resolve(dbPath ?? getDefaultDbPath());
}

export const DATA_DIR = getDefaultDataDir();
export const DEFAULT_DB_PATH = getDefaultDbPath();
