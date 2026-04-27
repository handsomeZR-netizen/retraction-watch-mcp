import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { BALANCED_POLICY } from "@rw/core";
import { screenManuscript } from "@rw/ingest";
import { requireUser } from "@/lib/auth/guard";
import { loadConfig } from "@/lib/config";
import { getRepository } from "@/lib/repository";
import { getUpload, saveResult } from "@/lib/store";
import { createSseStream, sseHeaders } from "@/lib/sse";
import {
  getManuscript,
  markManuscriptDone,
  markManuscriptError,
} from "@/lib/db/manuscripts";
import { writeScreeningLog } from "@/lib/db/screening-logs";
import { findUserById, getUserLlmSettings } from "@/lib/db/users";
import { canAccessManuscript } from "@/lib/auth/scope";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 600;

export async function GET(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { user } = auth;

  const url = new URL(req.url);
  const manuscriptId = url.searchParams.get("manuscriptId");
  if (!manuscriptId) {
    return NextResponse.json({ error: "manuscriptId required" }, { status: 400 });
  }
  const row = getManuscript(manuscriptId);
  if (!row || !canAccessManuscript(user, row)) {
    return NextResponse.json({ error: "manuscript not found" }, { status: 404 });
  }
  const upload = await getUpload(manuscriptId);
  if (!upload) {
    return NextResponse.json({ error: "manuscript file missing" }, { status: 404 });
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

      const userRow = findUserById(user.id);
      const userLlm = userRow ? getUserLlmSettings(userRow) : null;
      const effLlm = {
        enabled: userLlm?.enabled ?? config.llm.enabled,
        baseUrl: userLlm?.baseUrl || config.llm.baseUrl,
        apiKey: userLlm?.apiKey || config.llm.apiKey,
        model: userLlm?.model || config.llm.model,
        enableHeaderParse: userLlm?.enableHeaderParse ?? config.llm.enableHeaderParse,
      };
      const llm = effLlm.enabled && effLlm.apiKey
        ? { baseUrl: effLlm.baseUrl, apiKey: effLlm.apiKey, model: effLlm.model }
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
          llmHeader: effLlm.enabled && effLlm.enableHeaderParse,
          cloudOcr: config.ocr.cloudEnabled,
          progress: (ev) => sink.write(ev),
        },
      );

      await saveResult(manuscriptId, result);
      const resultPath = path.dirname(upload.filePath);
      markManuscriptDone({
        id: manuscriptId,
        verdict: result.verdict,
        totals: result.totals,
        metadataTitle: result.metadata.title,
        policyVersion: result.policyVersion,
        resultPath,
        generatedAt: result.generatedAt,
      });

      try {
        writeScreeningLog({
          result,
          userId: user.id,
          workspaceId: row.workspace_id,
          bytes: row.bytes,
          sha256: row.sha256,
        });
      } catch (logErr) {
        // eslint-disable-next-line no-console
        console.warn("[screening-logs] failed to persist:", logErr);
      }

      sink.write({
        stage: "done",
        message: `verdict=${result.verdict}; saved`,
        manuscriptId,
        detail: { totals: result.totals, verdict: result.verdict },
      });
      sink.close();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      markManuscriptError(manuscriptId, msg);
      sink.write({ stage: "error", message: msg });
      sink.close();
    }
  })();

  return new Response(stream, { headers: sseHeaders() });
}
