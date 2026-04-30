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
let shuttingDown = false;
let activeJob: ParseJob | null = null;
let drainPromise: Promise<void> | null = null;

export function startParseJob(input: {
  manuscriptId: string;
  user: CurrentUser;
}): { ok: true; parseJobId: string } | { ok: false; status: number; error: string } {
  if (shuttingDown) {
    return { ok: false, status: 503, error: "server is shutting down" };
  }
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

/**
 * True only when this process owns a runner state for the given manuscript.
 * Used by parse-stream to detect "DB says parsing but the producer process
 * died" so we can surface an error instead of hanging the SSE forever.
 */
export function hasParseState(manuscriptId: string): boolean {
  return states.has(manuscriptId);
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
  drainPromise = (async () => {
    try {
      for (;;) {
        // Once shutdown has begun, do not pick up new queued jobs — finish the
        // active one and let gracefulDrain flush whatever is still queued.
        if (shuttingDown) return;
        const job = queue.shift();
        if (!job) return;
        activeJob = job;
        try {
          await runParseJob(job);
        } finally {
          activeJob = null;
        }
      }
    } finally {
      processing = false;
      drainPromise = null;
    }
  })();
  return drainPromise;
}

/**
 * Mark the runner as shutting down: refuse new jobs, wait up to `timeoutMs`
 * for the in-flight job to finish, then mark anything still queued or
 * running as errored so the next process can re-acquire the lease.
 *
 * Always flushPendingAsError on the way out — `drainQueue` exits as soon as
 * shuttingDown is true, leaving queued jobs stranded as `parsing` unless we
 * sweep them here.
 */
export async function gracefulDrain(timeoutMs = 30_000): Promise<void> {
  shuttingDown = true;
  if (!drainPromise) {
    flushPendingAsError("server-restart");
    return;
  }
  const timeout = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), timeoutMs).unref?.(),
  );
  const outcome = await Promise.race([
    drainPromise.then(() => "done" as const),
    timeout,
  ]);
  flushPendingAsError(
    outcome === "timeout" ? "server-restart-timeout" : "server-restart",
  );
}

function flushPendingAsError(reason: string): void {
  const pending = queue.splice(0, queue.length);
  for (const job of pending) {
    markManuscriptError(job.manuscriptId, job.parseJobId, reason);
  }
  if (activeJob) {
    markManuscriptError(activeJob.manuscriptId, activeJob.parseJobId, reason);
    activeJob = null;
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

    const enrichmentContact =
      config.enrichment.contactEmail || process.env.RW_CONTACT_EMAIL || "";
    // Always honor RW_USE_ENRICHED_PIPELINE=0 as a kill switch, even when a
    // config file says enrichment is enabled. Without this short-circuit the
    // documented env rollback (set RW_USE_ENRICHED_PIPELINE=0 to stop
    // Crossref/EPMC/LLM enrichment traffic) is silently no-op'd because
    // options.enrichedPipeline takes precedence over the env in
    // screenManuscript.
    const enrichedEnabled =
      process.env.RW_USE_ENRICHED_PIPELINE === "0"
        ? false
        : config.enrichment.enabled;
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
        enrichedPipeline: enrichedEnabled,
        enrichmentContact: enrichmentContact || undefined,
        progress: (ev) => emit(job.manuscriptId, ev),
      },
    );

    const resultPath = path.dirname(upload.filePath);
    // Compare-and-set on parseJobId BEFORE writing result.json. If the lease
    // was already revoked (e.g. graceful-drain marked this job errored after
    // a timeout) markManuscriptDone returns false and we abandon the write so
    // we don't overwrite a (potentially stale) result file with one whose
    // owner never reclaimed the lease.
    const claimed = markManuscriptDone({
      id: job.manuscriptId,
      parseJobId: job.parseJobId,
      verdict: result.verdict,
      totals: result.totals,
      metadataTitle: result.metadata.title,
      policyVersion: result.policyVersion,
      resultPath,
      generatedAt: result.generatedAt,
    });
    if (!claimed) {
      console.warn(
        `[parse-runner] lease lost for ${job.manuscriptId}; skipping result.json + screening-log write`,
      );
      if (state) state.status = "error";
      return;
    }
    await saveResult(job.manuscriptId, result);

    try {
      writeScreeningLog({
        result,
        userId: job.userId,
        workspaceId: row.workspace_id,
        bytes: row.bytes,
        sha256: row.sha256,
      });
    } catch (logErr) {
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
    // markManuscriptError is itself parseJobId-scoped (UPDATE WHERE
    // parse_job_id = ?), so a no-op return here is safe even if the job's
    // lease was already revoked by graceful drain.
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
