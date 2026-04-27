"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Database,
  MagnifyingGlass,
  ShieldCheck,
  Sparkle,
} from "@phosphor-icons/react";
import { Card } from "@/components/ui/card";
import { Dropzone } from "@/components/Dropzone";
import { ParseOverlay } from "@/components/ParseOverlay";
import {
  ProgressTimeline,
  type TimelineEvent,
} from "@/components/ProgressTimeline";
import { Badge } from "@/components/ui/badge";

export default function HomePage() {
  const router = useRouter();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

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
    <div className="space-y-12">
      {transitioning && fileLabel && (
        <ParseOverlay fileName={fileLabel} />
      )}
      <section className="grid lg:grid-cols-[1.4fr_1fr] gap-10 items-start">
        <div className="space-y-5">
          <Badge variant="muted" className="text-[10px] uppercase tracking-wider">
            <Sparkle className="h-3 w-3" weight="fill" />
            学术诚信筛查 · 本地优先
          </Badge>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05]">
            一键检测稿件是否
            <br />
            引用了
            <span className="relative">
              <span className="relative z-10">撤稿文献</span>
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-1 h-2 bg-warning/30 -z-0"
              />
            </span>
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed max-w-xl">
            拖拽 PDF / Word / LaTeX 文件到下方，自动抽取作者信息和参考文献，比对本地
            Retraction Watch 数据库。所有解析默认在本地完成，启用 LLM
            增强或云 OCR 才会发起出网请求。
          </p>
          <div className="flex items-center gap-5 text-xs text-muted-foreground pt-1">
            <Tag icon={Database}>RW 全量</Tag>
            <Tag icon={ShieldCheck}>三档裁决</Tag>
            <Tag icon={MagnifyingGlass}>可解释证据</Tag>
          </div>
        </div>

        <div className="lg:sticky lg:top-24">
          <Dropzone
            onDrop={onDrop}
            busy={busy}
            hint={fileLabel ?? undefined}
          />
        </div>
      </section>

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

      <section className="grid md:grid-cols-3 gap-4">
        <Feature
          icon={MagnifyingGlass}
          title="参考文献抽取"
          desc="正则抽 DOI/PMID 覆盖现代论文 90%，无 DOI 的可选 LLM 结构化兜底。"
        />
        <Feature
          icon={Database}
          title="多路匹配"
          desc="DOI/PMID 精确命中、标题 Jaccard、作者重叠、年份 ±1，支持中文拼音回退。"
        />
        <Feature
          icon={ShieldCheck}
          title="可解释证据"
          desc="每条命中附 evidence 强弱明细；导出 JSON / CSV 报告供编辑复核。"
        />
      </section>
    </div>
  );
}

function Tag({
  icon: Icon,
  children,
}: {
  icon: typeof Database;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5" weight="duotone" />
      {children}
    </span>
  );
}

function Feature({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof Database;
  title: string;
  desc: string;
}) {
  return (
    <Card className="p-5 transition-colors hover:bg-accent/30">
      <Icon
        className="h-5 w-5 text-foreground mb-3"
        weight="duotone"
      />
      <h3 className="text-sm font-semibold mb-1.5">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
    </Card>
  );
}
