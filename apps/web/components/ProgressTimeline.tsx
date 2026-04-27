"use client";

import clsx from "clsx";
import {
  Check,
  CircleAlert,
  CloudUpload,
  FileSearch,
  FileText,
  Hash,
  ListCheck,
  Sparkles,
} from "lucide-react";
import { Spinner } from "./Spinner";

export type Stage =
  | "uploaded"
  | "text_extracted"
  | "metadata_extracted"
  | "refs_segmented"
  | "refs_structured"
  | "screening"
  | "done"
  | "error";

const STAGE_ORDER: Stage[] = [
  "uploaded",
  "text_extracted",
  "metadata_extracted",
  "refs_segmented",
  "refs_structured",
  "screening",
  "done",
];

const STAGE_META: Record<
  Stage,
  { label: string; icon: typeof Check }
> = {
  uploaded: { label: "已上传", icon: CloudUpload },
  text_extracted: { label: "文本提取", icon: FileText },
  metadata_extracted: { label: "元数据识别", icon: Hash },
  refs_segmented: { label: "参考文献切分", icon: FileSearch },
  refs_structured: { label: "结构化抽取", icon: Sparkles },
  screening: { label: "比对撤稿库", icon: ListCheck },
  done: { label: "完成", icon: Check },
  error: { label: "错误", icon: CircleAlert },
};

export interface TimelineEvent {
  stage: Stage;
  message?: string;
  detail?: Record<string, unknown>;
}

export function ProgressTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return null;

  const seen = new Set(events.map((e) => e.stage));
  const errored = seen.has("error");
  const lastStage = events[events.length - 1]?.stage;

  return (
    <ol className="space-y-2">
      {STAGE_ORDER.map((s) => {
        const ev = [...events].reverse().find((e) => e.stage === s);
        const reached = seen.has(s);
        const active = !errored && lastStage === s && s !== "done";
        const Icon = STAGE_META[s].icon;
        return (
          <li
            key={s}
            className={clsx(
              "flex items-start gap-3 px-3 py-2 rounded-lg transition-colors fade-in-up",
              reached ? "bg-white/[0.03]" : "opacity-40",
            )}
            style={
              reached ? { animationDelay: `${STAGE_ORDER.indexOf(s) * 40}ms` } : undefined
            }
          >
            <span
              className={clsx(
                "shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5",
                reached && !active && s !== "error"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : active
                    ? "bg-blue-500/15 text-blue-300"
                    : s === "error" && reached
                      ? "bg-red-500/15 text-red-300"
                      : "bg-white/5 text-slate-500",
              )}
            >
              {active ? (
                <Spinner />
              ) : reached ? (
                <Icon className="w-3.5 h-3.5" strokeWidth={2.2} />
              ) : (
                <Icon className="w-3.5 h-3.5" strokeWidth={1.6} />
              )}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {STAGE_META[s].label}
                </span>
                {active && (
                  <span className="text-[10px] text-blue-300 uppercase tracking-wider pulse-soft">
                    进行中
                  </span>
                )}
              </div>
              {ev?.message && (
                <div className="text-xs text-slate-400 mt-0.5 truncate">
                  {ev.message}
                </div>
              )}
            </div>
          </li>
        );
      })}
      {errored && (
        <li className="flex items-start gap-3 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20 fade-in-up">
          <CircleAlert className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1 text-sm text-red-200">
            {events.find((e) => e.stage === "error")?.message ?? "未知错误"}
          </div>
        </li>
      )}
    </ol>
  );
}
