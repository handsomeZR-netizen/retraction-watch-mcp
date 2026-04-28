// Next.js native instrumentation hook. Runs once per Node.js process startup,
// on both the dev server and the production runtime. We use it for:
//   - Pre-flight: verify data dirs are writable, RW database is accessible.
//   - Graceful shutdown: drain the in-memory parse queue on SIGTERM/SIGINT
//     so a Docker `stop` or systemd reload doesn't leave manuscripts stuck
//     in `parsing` state.
// https://nextjs.org/docs/app/api-reference/next-config-js/instrumentationHook

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const fs = await import("node:fs/promises");
  const { getDataDir, getConfigDir } = await import("@/lib/config");
  const { getAppDb } = await import("@/lib/db/app-db");
  const { getRepository } = await import("@/lib/repository");
  const { gracefulDrain } = await import("@/lib/parse-runner");

  // 1. Writable data directories
  const dirs = [getDataDir(), getConfigDir()];
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.access(dir, fs.constants.W_OK);
    } catch (err) {
      console.error(`[startup] data dir ${dir} not writable:`, err);
      process.exit(1);
    }
  }

  // 2. App DB (triggers migrations) — synchronous; throws on bad state.
  try {
    getAppDb();
  } catch (err) {
    console.error("[startup] failed to open app DB:", err);
    process.exit(1);
  }

  // 3. RW retraction database (read-only, large file). Failure is fatal in
  // production; tolerated in dev so the import-data flow has a chance to run.
  try {
    const repo = await getRepository();
    const snap = repo.getSourceSnapshot();
    if (!snap) {
      console.warn(
        "[startup] retraction-watch DB has no source_snapshots row; run `npm run import` to populate it",
      );
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

  // 4. SIGTERM / SIGINT: drain the parse queue then exit.
  let shuttingDown = false;
  const onSignal = (signal: NodeJS.Signals) => async () => {
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
  process.on("SIGTERM", onSignal("SIGTERM"));
  process.on("SIGINT", onSignal("SIGINT"));
}
