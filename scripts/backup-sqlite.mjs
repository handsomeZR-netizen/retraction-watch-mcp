// Hot-backup the rw-screen application SQLite DB.
//
// Uses better-sqlite3's native `db.backup()` (online backup API) so the file
// can be copied while writers are active. Output is gzip'd into RW_BACKUP_DIR
// (default: <RW_APP_DB_DIR>/backups), filename `app-YYYYMMDD-HHmm.sqlite.gz`.
// Rotates to keep at most RW_BACKUP_KEEP entries (default 30).
//
// Usage:
//   node scripts/backup-sqlite.mjs            # one-shot
//   docker exec rw node scripts/backup-sqlite.mjs
//
// Recommend cron / systemd timer once a day. Also safe to run at any time;
// no app downtime is required.

import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import Database from "better-sqlite3";

function pad(n) {
  return String(n).padStart(2, "0");
}

function timestamp() {
  const d = new Date();
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`
  );
}

function getAppDbDir() {
  if (process.env.RW_APP_DB_DIR) return path.resolve(process.env.RW_APP_DB_DIR);
  return path.join(os.homedir(), ".config", "rw-screen");
}

function getBackupDir() {
  if (process.env.RW_BACKUP_DIR) return path.resolve(process.env.RW_BACKUP_DIR);
  return path.join(getAppDbDir(), "backups");
}

const KEEP = Math.max(1, Number(process.env.RW_BACKUP_KEEP ?? 30));

async function main() {
  const dbPath = path.join(getAppDbDir(), "app.sqlite");
  const backupDir = getBackupDir();
  await fs.mkdir(backupDir, { recursive: true });

  const stamp = timestamp();
  const tmpPath = path.join(backupDir, `app-${stamp}.sqlite.tmp`);
  const finalPath = path.join(backupDir, `app-${stamp}.sqlite.gz`);

  // 1. Online backup to a sibling .tmp file. better-sqlite3's db.backup()
  // returns a Promise that resolves to { totalPages, remainingPages }.
  const db = new Database(dbPath, { readonly: true });
  try {
    await db.backup(tmpPath);
  } finally {
    db.close();
  }

  // 2. Gzip the temp file to .gz, then unlink the temp.
  await pipeline(
    createReadStream(tmpPath),
    createGzip({ level: 9 }),
    createWriteStream(finalPath),
  );
  await fs.unlink(tmpPath);

  // 3. Rotate: keep newest KEEP files, delete the rest.
  const entries = await fs.readdir(backupDir);
  const matches = entries
    .filter((e) => /^app-\d{8}-\d{4}\.sqlite\.gz$/.test(e))
    .sort()
    .reverse();
  for (const old of matches.slice(KEEP)) {
    await fs.unlink(path.join(backupDir, old)).catch(() => {});
  }

  const finalStat = await fs.stat(finalPath);
  console.log(
    `[backup] wrote ${finalPath} (${(finalStat.size / 1024).toFixed(1)} KB); kept ${Math.min(KEEP, matches.length)} of ${matches.length} files`,
  );
}

main().catch((err) => {
  console.error("[backup] failed:", err);
  process.exit(1);
});
