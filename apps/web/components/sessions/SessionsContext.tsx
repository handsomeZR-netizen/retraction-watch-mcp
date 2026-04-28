"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

export interface ActiveSession {
  manuscriptId: string;
  fileName: string;
  bytes?: number;
  startedAt: number;
  status: "uploading" | "parsing" | "done" | "error" | "deduped";
  stage?: string;
  message?: string;
  progress?: { current: number; total: number };
  error?: string;
}

interface SessionsContextValue {
  active: ActiveSession[];
  start: (input: { file: File; projectId?: string | null }) => Promise<void>;
  dismiss: (manuscriptId: string) => void;
  bumpRefreshToken: () => void;
  refreshToken: number;
}

const SessionsContext = createContext<SessionsContextValue | null>(null);

const STAGE_ORDER = [
  "uploaded",
  "text_extracted",
  "metadata_extracted",
  "authors_screened",
  "refs_segmented",
  "refs_structured",
  "screening",
  "done",
];

export function SessionsProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<ActiveSession[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const sources = useRef<Map<string, EventSource>>(new Map());

  useEffect(() => {
    const map = sources.current;
    return () => {
      for (const sse of map.values()) sse.close();
      map.clear();
    };
  }, []);

  const update = useCallback((id: string, patch: Partial<ActiveSession>) => {
    setActive((prev) =>
      prev.map((s) => (s.manuscriptId === id ? { ...s, ...patch } : s)),
    );
  }, []);

  const dismiss = useCallback((id: string) => {
    const sse = sources.current.get(id);
    if (sse) {
      sse.close();
      sources.current.delete(id);
    }
    setActive((prev) => prev.filter((s) => s.manuscriptId !== id));
  }, []);

  const bumpRefreshToken = useCallback(() => {
    setRefreshToken((n) => n + 1);
  }, []);

  const start = useCallback(
    async ({ file, projectId }: { file: File; projectId?: string | null }) => {
      const placeholderId = `tmp-${crypto.randomUUID()}`;
      const seedSession: ActiveSession = {
        manuscriptId: placeholderId,
        fileName: file.name,
        bytes: file.size,
        startedAt: Date.now(),
        status: "uploading",
      };
      setActive((prev) => [seedSession, ...prev]);

      try {
        const formData = new FormData();
        formData.append("file", file);
        if (projectId) formData.append("projectId", projectId);
        const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
        if (!uploadRes.ok) throw new Error(await uploadRes.text());
        const json = (await uploadRes.json()) as {
          manuscriptId: string;
          deduped?: boolean;
        };
        // Replace placeholder with the real manuscriptId.
        setActive((prev) =>
          prev.map((s) =>
            s.manuscriptId === placeholderId
              ? { ...s, manuscriptId: json.manuscriptId }
              : s,
          ),
        );

        if (json.deduped) {
          update(json.manuscriptId, {
            status: "deduped",
            message: "已识别为重复上传，复用历史报告",
          });
          bumpRefreshToken();
          toast.success("识别为重复文件，复用历史报告");
          return;
        }

        update(json.manuscriptId, { status: "parsing", stage: "uploaded" });
        const sse = new EventSource(
          `/api/parse?manuscriptId=${encodeURIComponent(json.manuscriptId)}`,
        );
        sources.current.set(json.manuscriptId, sse);

        sse.onmessage = (ev) => {
          if (!ev.data) return;
          try {
            const payload = JSON.parse(ev.data) as {
              stage: string;
              message?: string;
              detail?: { progress?: number; total?: number };
            };
            const progress =
              payload.detail?.progress != null && payload.detail?.total != null
                ? { current: payload.detail.progress, total: payload.detail.total }
                : undefined;
            update(json.manuscriptId, {
              stage: payload.stage,
              message: payload.message,
              progress,
            });
            if (payload.stage === "done") {
              update(json.manuscriptId, { status: "done" });
              sse.close();
              sources.current.delete(json.manuscriptId);
              bumpRefreshToken();
              toast.success(`解析完成：${file.name}`);
            }
            if (payload.stage === "error") {
              update(json.manuscriptId, { status: "error", error: payload.message });
              sse.close();
              sources.current.delete(json.manuscriptId);
              bumpRefreshToken();
              toast.error(`解析失败：${payload.message ?? "未知错误"}`);
            }
          } catch {
            /* ignore */
          }
        };
        sse.onerror = () => {
          update(json.manuscriptId, { status: "error", error: "SSE 连接断开" });
          sse.close();
          sources.current.delete(json.manuscriptId);
          bumpRefreshToken();
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setActive((prev) =>
          prev.map((s) =>
            s.manuscriptId === placeholderId
              ? { ...s, status: "error", error: msg }
              : s,
          ),
        );
        toast.error(`上传失败：${msg}`);
      }
    },
    [update, bumpRefreshToken],
  );

  const value = useMemo<SessionsContextValue>(
    () => ({ active, start, dismiss, bumpRefreshToken, refreshToken }),
    [active, start, dismiss, bumpRefreshToken, refreshToken],
  );

  return <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>;
}

export function useSessions(): SessionsContextValue {
  const ctx = useContext(SessionsContext);
  if (!ctx) throw new Error("useSessions must be used inside SessionsProvider");
  return ctx;
}

export function progressPercent(session: ActiveSession): number {
  if (session.status === "done" || session.status === "deduped") return 100;
  if (session.status === "error") return 0;
  if (session.stage === "screening" && session.progress) {
    // Screening reports n/total; proportionally scale within the screening band.
    const base = STAGE_ORDER.indexOf("screening");
    const stageBand = 1 / STAGE_ORDER.length;
    const within = session.progress.current / Math.max(session.progress.total, 1);
    return Math.min(95, ((base + within) / STAGE_ORDER.length) * 100);
  }
  const idx = session.stage ? STAGE_ORDER.indexOf(session.stage) : 0;
  if (idx < 0) return 5;
  return Math.min(95, ((idx + 1) / STAGE_ORDER.length) * 100);
}
