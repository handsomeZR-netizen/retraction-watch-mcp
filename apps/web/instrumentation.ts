// Next.js instrumentation hook entrypoint. We split the actual startup logic
// into instrumentation-node.ts so webpack doesn't try to bundle it for the
// edge runtime (which can't resolve native modules like better-sqlite3).
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
