import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export default async function globalTeardown(): Promise<void> {
  const root = process.env.RW_WEB_E2E_ROOT;
  if (!root) return;

  const resolved = path.resolve(root);
  const tmp = path.resolve(os.tmpdir());
  const name = path.basename(resolved);

  if (resolved.startsWith(tmp) && name.startsWith("rw-web-e2e-")) {
    try {
      await fs.rm(resolved, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 250,
      });
    } catch {
      /* best effort */
    }
  }
}
