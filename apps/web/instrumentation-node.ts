// Node-runtime startup logic. Loaded lazily by instrumentation.ts so webpack
// keeps the heavy native imports (better-sqlite3) out of the edge bundle.

import fs from "node:fs/promises";
import { getConfigDir, getDataDir } from "@/lib/config";
import { getAppDb } from "@/lib/db/app-db";
import { recoverStaleParseLeases } from "@/lib/db/manuscripts";
import { gracefulDrain } from "@/lib/parse-runner";
import { getRepository } from "@/lib/repository";

// Pre-flight: data directories writable
const dirs = [getDataDir(), getConfigDir()];
for (const dir of dirs) {
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.access(dir, (await import("node:fs")).constants.W_OK);
  } catch (err) {
    console.error(`[startup] data dir ${dir} not writable:`, err);
    process.exit(1);
  }
}

// Open app DB (triggers migrations) — synchronous; throws on bad state.
try {
  getAppDb();
  // Reset any manuscripts the previous process left in `parsing` state. The
  // in-memory queue does not survive restart so those rows would otherwise
  // be stuck forever.
  const recovered = recoverStaleParseLeases("server-restart-recovery");
  if (recovered > 0) {
    console.warn(`[startup] reset ${recovered} stale parsing manuscript(s) from previous process`);
  }
} catch (err) {
  console.error("[startup] failed to open app DB:", err);
  process.exit(1);
}

// Validate retraction-watch DB. In production a missing source_snapshots row
// is fatal — every screening would silently match nothing.
try {
  const repo = await getRepository();
  const snap = repo.getSourceSnapshot();
  if (!snap) {
    const msg =
      "retraction-watch DB has no source_snapshots row; run `npm run import` to populate it";
    if (process.env.NODE_ENV === "production") {
      console.error(`[startup] ${msg}`);
      process.exit(1);
    }
    console.warn(`[startup] ${msg}`);
  } else {
    console.log(
      `[startup] RW DB ready: ${snap.rowCount.toLocaleString()} rows, generated ${snap.generatedOn}`,
    );
  }
} catch (err) {
  if (process.env.NODE_ENV === "production") {
    console.error("[startup] retraction-watch DB unavailable:", err);
    process.exit(1);
  }
  console.warn("[startup] retraction-watch DB unavailable (dev tolerated):", err);
}

// Graceful shutdown: drain the in-memory parse queue then exit.
let shuttingDown = false;
function onSignal(signal: NodeJS.Signals) {
  return async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received; draining parse queue...`);
    try {
      await gracefulDrain(30_000);
      console.log("[shutdown] drain complete");
    } catch (err) {
      console.error("[shutdown] drain error:", err);
    }
    process.exit(0);
  };
}
process.on("SIGTERM", onSignal("SIGTERM"));
process.on("SIGINT", onSignal("SIGINT"));
