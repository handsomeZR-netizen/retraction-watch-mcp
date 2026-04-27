"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dropzone } from "@/components/Dropzone";
import { ParseOverlay } from "@/components/ParseOverlay";
import {
  ProgressTimeline,
  type TimelineEvent,
} from "@/components/ProgressTimeline";
import { Badge } from "@/components/ui/badge";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { RecentList } from "@/components/dashboard/RecentList";
import { ScopeBanner } from "@/components/dashboard/ScopeBanner";
import { StatsRow } from "@/components/dashboard/StatsRow";

interface Dashboard {
  user: {
    id: string;
    displayName: string | null;
    username: string;
    role: "admin" | "user";
    avatarSeed: string;
  };
  scope: { workspaceId: string | null };
  workspace: { id: string; name: string; slug: string; memberCount: number } | null;
  stats: {
    total: number;
    pass: number;
    review: number;
    fail: number;
    parsing: number;
    error: number;
    last7d: number;
  };
  recent: Array<{
    id: string;
    fileName: string;
    fileType: string;
    uploadedAt: string;
    status: "parsing" | "done" | "error";
    verdict: "PASS" | "REVIEW" | "FAIL" | null;
    title: string | null;
    totals: Record<string, number> | null;
  }>;
  llm: { enabled: boolean; model: string };
  source: { rowCount: number; generatedOn: string | null } | null;
}

export default function HomePage() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard");
      if (res.ok) {
        const j = (await res.json()) as Dashboard;
        setData(j);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => () => sseRef.current?.close(), []);

  const onDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      setBusy(true);
      setError(null);
      setFileLabel(`${file.name} · ${(file.size / 1024).toFixed(1)} KB`);
      setEvents([{ stage: "uploaded", message: `已接收 ${file.name}` }]);

      try {
        const formData = new FormData();
        formData.append("file", file);
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok) throw new Error(await uploadRes.text());
        const { manuscriptId } = (await uploadRes.json()) as {
          manuscriptId: string;
        };

        const sse = new EventSource(
          `/api/parse?manuscriptId=${encodeURIComponent(manuscriptId)}`,
        );
        sseRef.current = sse;
        sse.onmessage = (ev) => {
          if (!ev.data) return;
          try {
            const payload = JSON.parse(ev.data) as TimelineEvent;
            setEvents((prev) => [...prev, payload]);
            if (payload.stage === "done") {
              sse.close();
              sseRef.current = null;
              setTransitioning(true);
              router.prefetch(`/result/${encodeURIComponent(manuscriptId)}`);
              setTimeout(
                () =>
                  router.push(`/result/${encodeURIComponent(manuscriptId)}`),
                700,
              );
            }
            if (payload.stage === "error") {
              sse.close();
              sseRef.current = null;
              setBusy(false);
              setError(payload.message ?? "解析失败");
            }
          } catch {
            // ignore
          }
        };
        sse.onerror = () => {
          sse.close();
          sseRef.current = null;
          setBusy(false);
          setError("SSE 连接断开");
        };
      } catch (e) {
        setBusy(false);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [router],
  );

  return (
    <div className="space-y-8">
      {transitioning && fileLabel && <ParseOverlay fileName={fileLabel} />}

      <section className="grid lg:grid-cols-[1.4fr_1fr] gap-8 items-start">
        <div>
          {data ? (
            <ScopeBanner
              user={{
                displayName: data.user.displayName,
                username: data.user.username,
              }}
              workspace={data.workspace}
              llm={data.llm}
              source={data.source}
            />
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-10 w-56" />
              <div className="flex gap-2">
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-7 w-40" />
              </div>
            </div>
          )}
        </div>
        <div className="lg:sticky lg:top-20">
          <Dropzone
            onDrop={onDrop}
            busy={busy}
            hint={fileLabel ?? undefined}
          />
        </div>
      </section>

      {data ? (
        <StatsRow stats={data.stats} />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}

      {error && (
        <Card className="border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive animate-fade-in-up">
          {error}
        </Card>
      )}

      {events.length > 0 && (
        <Card className="p-6 animate-fade-in-up">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">解析进度</h2>
            {fileLabel && (
              <Badge variant="muted" className="font-mono text-[11px]">
                {fileLabel}
              </Badge>
            )}
          </div>
          <ProgressTimeline events={events} />
        </Card>
      )}

      <section className="grid lg:grid-cols-[1.4fr_1fr] gap-6 items-start">
        <div>
          {data ? (
            <RecentList items={data.recent} />
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </div>
        <div>
          {data ? (
            <QuickActions role={data.user.role} />
          ) : (
            <Skeleton className="h-56 w-full" />
          )}
        </div>
      </section>
    </div>
  );
}
