import fs from "node:fs/promises";
import path from "node:path";
import { getDataDir, loadConfig } from "@/lib/config";
import { getAppDb } from "@/lib/db/app-db";
import {
  deleteManuscript,
  listErroredManuscriptsOlderThan,
} from "@/lib/db/manuscripts";
import { deleteOldUploads } from "@/lib/store";

function buildProtectedFilter(): (id: string) => boolean {
  // Snapshot the set of manuscripts that retention sweep MUST NOT touch:
  //   - status='parsing': in flight, deleting mid-parse corrupts the run
  //   - status='done':    holds a user's screening result + original PDF;
  //                       only explicit user deletion may remove it.
  // Errored manuscripts are intentionally NOT protected here — they are
  // handled by `deleteErroredManuscripts` which also drops the DB row, so
  // there's no orphan-row hazard.
  const rows = getAppDb()
    .prepare("SELECT id FROM manuscripts WHERE status IN ('parsing', 'done')")
    .all() as { id: string }[];
  const protectedIds = new Set(rows.map((r) => r.id));
  return (id: string) => protectedIds.has(id);
}

let started = false;
let running = false;
let timer: NodeJS.Timeout | null = null;

export function ensureCleanupCronStarted(): void {
  if (started) return;
  started = true;
  void runCleanupOnce();
  timer = setInterval(() => {
    void runCleanupOnce();
  }, 60 * 60_000);
  timer.unref?.();
}

async function runCleanupOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const config = await loadConfig();
    const keepHours = config.retention.keepHours;
    const isProtected = buildProtectedFilter();
    // Honor the "keep all uploads" config flag — previously we always pruned
    // by age regardless of this setting.
    const removedUploads = config.retention.keepUploads
      ? 0
      : await deleteOldUploads(keepHours, { isInProgress: isProtected });
    const removedErrors = await deleteErroredManuscripts(keepHours);
    const ghostsCleared = await reconcileGhostManuscripts();
    if (removedUploads > 0 || removedErrors > 0 || ghostsCleared > 0) {
      console.warn(
        `[cleanup] removed uploads=${removedUploads}, errored manuscripts=${removedErrors}, ghosts reconciled=${ghostsCleared}`,
      );
    }
  } catch (err) {
    console.warn("[cleanup] failed:", err);
  } finally {
    running = false;
  }
}

/**
 * Some past deploys had a retention bug that wiped done manuscripts off disk
 * without touching the DB row. Those rows still show up in the sidebar and
 * history list, but every click 404s because result.json is gone. Find them
 * and flip status to 'error' so the UI stops surfacing them as healthy
 * results — the row is kept (so audit + screening_logs FKs remain valid).
 */
async function reconcileGhostManuscripts(): Promise<number> {
  const dataDir = getDataDir();
  const rows = getAppDb()
    .prepare("SELECT id FROM manuscripts WHERE status = 'done'")
    .all() as { id: string }[];
  let ghosts = 0;
  for (const row of rows) {
    const dir = path.join(dataDir, row.id);
    let dirExists = true;
    try {
      await fs.stat(dir);
    } catch {
      dirExists = false;
    }
    if (!dirExists) {
      getAppDb()
        .prepare(
          "UPDATE manuscripts SET status = 'error', error = ? WHERE id = ? AND status = 'done'",
        )
        .run("source files removed by retention sweep (legacy bug)", row.id);
      ghosts += 1;
    }
  }
  return ghosts;
}

async function deleteErroredManuscripts(keepHours: number): Promise<number> {
  const cutoff = new Date(Date.now() - keepHours * 3600_000).toISOString();
  const rows = listErroredManuscriptsOlderThan(cutoff);
  let removed = 0;
  for (const row of rows) {
    await fs.rm(path.join(getDataDir(), row.id), { recursive: true, force: true });
    if (row.result_path) {
      await fs.rm(path.join(row.result_path, "result.json"), { force: true });
    }
    if (deleteManuscript(row.id)) removed += 1;
  }
  return removed;
}
