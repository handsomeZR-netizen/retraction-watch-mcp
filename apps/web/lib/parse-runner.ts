import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { BALANCED_POLICY } from "@rw/core";
import { screenManuscript } from "@rw/ingest";
import { canAccessManuscript } from "@/lib/auth/scope";
import { loadConfig } from "@/lib/config";
import {
  acquireParseLease,
  getManuscript,
  markManuscriptDone,
  markManuscriptError,
  type ManuscriptRow,
} from "@/lib/db/manuscripts";
import { writeScreeningLog } from "@/lib/db/screening-logs";
import { findUserById, getUserLlmSettings } from "@/lib/db/users";
import { getRepository } from "@/lib/repository";
import { getUpload, saveResult } from "@/lib/store";
import type { CurrentUser } from "@/lib/auth/session";

export interface ParseProgressEvent {
  stage: string;
  message?: string;
  manuscriptId?: string;
  detail?: unknown;
}

interface ParseJob {
  manuscriptId: string;
  parseJobId: string;
  userId: string;
}

interface ParseState {
  manuscriptId: string;
  parseJobId: string;
  status: "queued" | "running" | "done" | "error";
  events: ParseProgressEvent[];
}

const emitter = new EventEmitter();
const states = new Map<string, ParseState>();
const queue: ParseJob[] = [];
let processing = false;

export function startParseJob(input: {
  manuscriptId: string;
  user: CurrentUser;
}): { ok: true; parseJobId: string } | { ok: false; status: number; error: string } {
  const row = getManuscript(input.manuscriptId);
  if (!row || !canAccessManuscript(input.user, row)) {
    return { ok: false, status: 404, error: "manuscript not found" };
  }
  const parseJobId = randomUUID();
  if (!acquireParseLease(input.manuscriptId, parseJobId)) {
    return { ok: false, status: 409, error: "manuscript is already parsing" };
  }
  const state: ParseState = {
    manuscriptId: input.manuscriptId,
    parseJobId,
    status: "queued",
    events: [],
  };
  states.set(input.manuscriptId, state);
  emit(input.manuscriptId, { stage: "queued", message: "解析任务已入队" });
  queue.push({ manuscriptId: input.manuscriptId, parseJobId, userId: input.user.id });
  void drainQueue();
  return { ok: true, parseJobId };
}

export function subscribeParseProgress(
  manuscriptId: string,
  onEvent: (event: ParseProgressEvent) => void,
): () => void {
  const state = states.get(manuscriptId);
  if (state) {
    for (const event of state.events) onEvent(event);
  }
  const listener = (event: ParseProgressEvent) => onEvent(event);
  emitter.on(manuscriptId, listener);
  return () => emitter.off(manuscriptId, listener);
}

async function drainQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      await runParseJob(job);
    }
  } finally {
    processing = false;
  }
}

async function runParseJob(job: ParseJob): Promise<void> {
  const state = states.get(job.manuscriptId);
  if (state) state.status = "running";
  const row = getManuscript(job.manuscriptId);
  try {
    if (!row) throw new Error("manuscript not found");
    const upload = await getUpload(job.manuscriptId);
    if (!upload) throw new Error("manuscript file missing");

    const config = await loadConfig();
    const repo = await getRepository();
    const buffer = await fs.readFile(upload.filePath);
    emit(job.manuscriptId, {
      stage: "uploaded",
      message: `${upload.fileName} (${(upload.bytes / 1024).toFixed(1)} KB)`,
    });

    const userRow = findUserById(job.userId);
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
        manuscriptId: job.manuscriptId,
        fileName: upload.fileName,
        fileType: upload.fileType,
        buffer,
      },
      {
        policy: BALANCED_POLICY,
        llm,
        llmHeader: effLlm.enabled && effLlm.enableHeaderParse,
        cloudOcr: config.ocr.cloudEnabled,
        progress: (ev) => emit(job.manuscriptId, ev),
      },
    );

    await saveResult(job.manuscriptId, result);
    const resultPath = path.dirname(upload.filePath);
    markManuscriptDone({
      id: job.manuscriptId,
      parseJobId: job.parseJobId,
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
        userId: job.userId,
        workspaceId: row.workspace_id,
        bytes: row.bytes,
        sha256: row.sha256,
      });
    } catch (logErr) {
      // eslint-disable-next-line no-console
      console.warn("[screening-logs] failed to persist:", logErr);
    }

    if (state) state.status = "done";
    emit(job.manuscriptId, {
      stage: "done",
      message: `verdict=${result.verdict}; saved`,
      manuscriptId: job.manuscriptId,
      detail: { totals: result.totals, verdict: result.verdict },
    });
    scheduleStateCleanup(job.manuscriptId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    markManuscriptError(job.manuscriptId, job.parseJobId, msg);
    if (state) state.status = "error";
    emit(job.manuscriptId, { stage: "error", message: msg });
    scheduleStateCleanup(job.manuscriptId);
  }
}

function emit(manuscriptId: string, event: ParseProgressEvent): void {
  const state = states.get(manuscriptId);
  if (state) {
    state.events.push(event);
    if (state.events.length > 200) state.events.shift();
  }
  emitter.emit(manuscriptId, event);
}

function scheduleStateCleanup(manuscriptId: string): void {
  const timer = setTimeout(() => states.delete(manuscriptId), 60 * 60_000);
  timer.unref?.();
}
