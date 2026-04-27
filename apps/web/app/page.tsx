"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Database, FileSearch, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { Dropzone } from "@/components/Dropzone";
import { ProgressTimeline, type Stage, type TimelineEvent } from "@/components/ProgressTimeline";

export default function HomePage() {
  const router = useRouter();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
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
        const { manuscriptId } = (await uploadRes.json()) as { manuscriptId: string };

        const sse = new EventSource(`/api/parse?manuscriptId=${encodeURIComponent(manuscriptId)}`);
        sseRef.current = sse;
        sse.onmessage = (ev) => {
          if (!ev.data) return;
          try {
            const payload = JSON.parse(ev.data) as TimelineEvent & { manuscriptId?: string };
            setEvents((prev) => [...prev, payload]);
            if (payload.stage === "done") {
              sse.close();
              sseRef.current = null;
              setTimeout(
                () => router.push(`/result/${encodeURIComponent(manuscriptId)}`),
                500,
              );
            }
            if (payload.stage === "error") {
              sse.close();
              sseRef.current = null;
              setBusy(false);
              setError(payload.message ?? "解析失败");
            }
          } catch {
            // ignore non-JSON
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
    <div className="space-y-10">
      <section className="grid lg:grid-cols-[1.4fr_1fr] gap-8 items-start">
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs bg-blue-500/10 border border-blue-500/20 text-blue-300">
            <Sparkles className="w-3 h-3" />
            学术诚信筛查 · 本地优先
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-[1.1]">
            一键检测稿件是否
            <br />
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              引用了撤稿文献
            </span>
          </h1>
          <p className="text-slate-400 text-base leading-relaxed max-w-xl">
            拖拽 PDF / Word / LaTeX 文件到下方，自动抽取作者信息和参考文献，并比对本地
            Retraction Watch 数据库。引用了已撤稿文献的稿件会标记为不通过。
            所有解析默认在本地完成；启用 LLM 增强或云 OCR 才会发起出网请求。
          </p>
          <div className="flex items-center gap-5 text-xs text-slate-500 pt-2">
            <span className="inline-flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5" /> Retraction Watch 全量
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" /> 三档裁决（PASS/REVIEW/FAIL）
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" /> 隐私优先
            </span>
          </div>
        </div>

        <div className="lg:sticky lg:top-24">
          <Dropzone onDrop={onDrop} busy={busy} hint={fileLabel ?? undefined} />
        </div>
      </section>

      {error && (
        <div className="surface px-4 py-3 border border-rose-500/30 bg-rose-500/5 text-rose-200 text-sm fade-in-up">
          ✗ {error}
        </div>
      )}

      {events.length > 0 && (
        <section className="surface p-6 fade-in-up">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">解析进度</h2>
            {fileLabel && (
              <span className="badge badge-muted code">{fileLabel}</span>
            )}
          </div>
          <ProgressTimeline events={events} />
        </section>
      )}

      <section className="grid md:grid-cols-3 gap-4">
        <FeatureCard
          icon={FileSearch}
          title="参考文献抽取"
          desc="正则抽 DOI/PMID 覆盖现代论文 ~90%，无 DOI 的可选 LLM 结构化兜底"
        />
        <FeatureCard
          icon={Database}
          title="多路匹配"
          desc="DOI/PMID 精确命中、标题 Jaccard、作者重叠、年份 ±1，支持中文拼音回退"
        />
        <FeatureCard
          icon={ShieldCheck}
          title="可解释证据"
          desc="每条命中附 evidence[] 强弱明细；导出 JSON / CSV 报告供编辑复核"
        />
      </section>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof FileSearch;
  title: string;
  desc: string;
}) {
  return (
    <div className="surface px-5 py-5 surface-hover transition-colors">
      <Icon className="w-5 h-5 text-blue-400 mb-3" strokeWidth={1.8} />
      <h3 className="text-sm font-semibold mb-1.5">{title}</h3>
      <p className="text-xs text-slate-400 leading-relaxed">{desc}</p>
    </div>
  );
}
