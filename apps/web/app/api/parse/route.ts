import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { BALANCED_POLICY } from "@rw/core";
import { screenManuscript } from "@rw/ingest";
import { loadConfig } from "@/lib/config";
import { getRepository } from "@/lib/repository";
import { getUpload, saveResult } from "@/lib/store";
import { createSseStream, sseHeaders } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 600;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const manuscriptId = url.searchParams.get("manuscriptId");
  if (!manuscriptId) {
    return NextResponse.json({ error: "manuscriptId required" }, { status: 400 });
  }
  const upload = await getUpload(manuscriptId);
  if (!upload) {
    return NextResponse.json({ error: "manuscript not found" }, { status: 404 });
  }

  const config = await loadConfig();
  const { stream, sink } = createSseStream();

  (async () => {
    try {
      const repo = await getRepository();
      const buffer = await fs.readFile(upload.filePath);
      sink.write({
        stage: "uploaded",
        message: `${upload.fileName} (${(upload.bytes / 1024).toFixed(1)} KB)`,
      });

      const llm =
        config.llm.enabled && config.llm.apiKey
          ? {
              baseUrl: config.llm.baseUrl,
              apiKey: config.llm.apiKey,
              model: config.llm.model,
            }
          : undefined;

      const result = await screenManuscript(
        repo,
        {
          manuscriptId,
          fileName: upload.fileName,
          fileType: upload.fileType,
          buffer,
        },
        {
          policy: BALANCED_POLICY,
          llm,
          llmHeader: config.llm.enabled && config.llm.enableHeaderParse,
          cloudOcr: config.ocr.cloudEnabled,
          progress: (ev) => sink.write(ev),
        },
      );

      await saveResult(manuscriptId, result);

      sink.write({
        stage: "done",
        message: `verdict=${result.verdict}; saved`,
        manuscriptId,
        detail: { totals: result.totals, verdict: result.verdict },
      });
      sink.close();
    } catch (err) {
      sink.write({
        stage: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      sink.close();
    }
  })();

  return new Response(stream, { headers: sseHeaders() });
}
