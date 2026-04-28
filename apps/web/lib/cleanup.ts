import fs from "node:fs/promises";
import path from "node:path";
import { getDataDir, loadConfig } from "@/lib/config";
import { getAppDb } from "@/lib/db/app-db";
import {
  deleteManuscript,
  listErroredManuscriptsOlderThan,
} from "@/lib/db/manuscripts";
import { deleteOldUploads } from "@/lib/store";

function buildInProgressFilter(): (id: string) => boolean {
  // Snapshot the set of manuscripts currently in `parsing` status so cleanup
  // never deletes their upload dir mid-parse. Snapshot per cleanup pass; a new
  // job started during the pass simply gets cleaned next tick if eligible.
  const rows = getAppDb()
    .prepare("SELECT id FROM manuscripts WHERE status = 'parsing'")
    .all() as { id: string }[];
  const inFlight = new Set(rows.map((r) => r.id));
  return (id: string) => inFlight.has(id);
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
    const isInProgress = buildInProgressFilter();
    // Honor the "keep all uploads" config flag — previously we always pruned
    // by age regardless of this setting.
    const removedUploads = config.retention.keepUploads
      ? 0
      : await deleteOldUploads(keepHours, { isInProgress });
    const removedErrors = await deleteErroredManuscripts(keepHours);
    if (removedUploads > 0 || removedErrors > 0) {
      console.warn(
        `[cleanup] removed uploads=${removedUploads}, errored manuscripts=${removedErrors}`,
      );
    }
  } catch (err) {
    console.warn("[cleanup] failed:", err);
  } finally {
    running = false;
  }
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
