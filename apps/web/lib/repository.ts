import { RetractionWatchRepository } from "@rw/core";

let repoPromise: Promise<RetractionWatchRepository> | null = null;

export async function getRepository(): Promise<RetractionWatchRepository> {
  if (!repoPromise) {
    repoPromise = RetractionWatchRepository.open(process.env.RW_MCP_DB_PATH).catch((err) => {
      repoPromise = null;
      throw err;
    });
  }
  return repoPromise;
}
