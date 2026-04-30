"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dropzone } from "@/components/Dropzone";
import { HomeIntroCard } from "@/components/dashboard/HomeIntroCard";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { RecentList } from "@/components/dashboard/RecentList";
import { ScopeBanner } from "@/components/dashboard/ScopeBanner";
import { StatsRow } from "@/components/dashboard/StatsRow";
import { useSessions } from "@/components/sessions/SessionsContext";

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
  llm: {
    enabled: boolean;
    model: string;
    source: "user" | "env" | "config" | "default";
    hasApiKey: boolean;
  };
  enrichment: {
    enabled: boolean;
    hasContactEmail: boolean;
  };
  source: { rowCount: number; generatedOn: string | null } | null;
}

export default function HomePage() {
  const sessions = useSessions();
  const [data, setData] = useState<Dashboard | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
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
  }, [loadDashboard, sessions.refreshToken]);

  const onDrop = useCallback(
    async (files: File[]) => {
      // Parallel: upload + parse-start are independent network calls, and the
      // server's parse queue still serializes the actual screening jobs. Drop
      // 5 PDFs at once and they all start uploading immediately.
      await Promise.all(files.map((file) => sessions.start({ file })));
    },
    [sessions],
  );

  return (
    <div className="space-y-8">
      <section className="grid lg:grid-cols-[1.4fr_1fr] gap-8 items-start">
        <div className="space-y-6">
          {data ? (
            <ScopeBanner
              user={{
                displayName: data.user.displayName,
                username: data.user.username,
              }}
              workspace={data.workspace}
              llm={data.llm}
              enrichment={data.enrichment}
              source={data.source}
              onLlmChanged={loadDashboard}
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
          <HomeIntroCard />
        </div>
        <div className="lg:sticky lg:top-20">
          <Dropzone
            onDrop={onDrop}
            busy={sessions.active.some((s) => s.status === "uploading" || s.status === "parsing")}
            hint={
              sessions.active.length > 0
                ? `进行中：${sessions.active.length} 个会话`
                : "拖入 PDF / Word / LaTeX；可同时拖多份"
            }
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

      {sessions.active.some((s) => s.status === "error") && (
        <Card className="border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive animate-fade-in-up">
          {sessions.active
            .filter((s) => s.status === "error")
            .map((s) => `${s.fileName}：${s.error ?? "解析失败"}`)
            .join("\n")}
        </Card>
      )}

      <section className="grid xl:grid-cols-[1.4fr_1fr] gap-6 items-start">
        <div>
          {data ? (
            <RecentList items={data.recent} />
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </div>
        <div>
          {data ? <QuickActions role={data.user.role} /> : <Skeleton className="h-56 w-full" />}
        </div>
      </section>
    </div>
  );
}
