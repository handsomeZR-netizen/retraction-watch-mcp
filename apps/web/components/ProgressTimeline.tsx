"use client";

import {
  Check,
  Warning,
  CloudArrowUp,
  MagnifyingGlass,
  FileText,
  Hash,
  Sparkle,
  CheckCircle,
  CircleNotch,
  ListChecks,
  Detective,
  type Icon as PIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export type Stage =
  | "uploaded"
  | "text_extracted"
  | "metadata_extracted"
  | "authors_screened"
  | "refs_segmented"
  | "refs_structured"
  | "screening"
  | "done"
  | "error";

const STAGE_ORDER: Stage[] = [
  "uploaded",
  "text_extracted",
  "metadata_extracted",
  "authors_screened",
  "refs_segmented",
  "refs_structured",
  "screening",
  "done",
];

const STAGE_META: Record<Stage, { label: string; icon: PIcon }> = {
  uploaded: { label: "已上传", icon: CloudArrowUp },
  text_extracted: { label: "文本提取", icon: FileText },
  metadata_extracted: { label: "元数据识别", icon: Hash },
  authors_screened: { label: "作者撤稿史比对", icon: Detective },
  refs_segmented: { label: "参考文献切分", icon: MagnifyingGlass },
  refs_structured: { label: "结构化抽取", icon: Sparkle },
  screening: { label: "比对撤稿库", icon: ListChecks },
  done: { label: "完成", icon: CheckCircle },
  error: { label: "错误", icon: Warning },
};

void Check;

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
    <ol className="relative space-y-1">
      {STAGE_ORDER.map((s, idx) => {
        const ev = [...events].reverse().find((e) => e.stage === s);
        const reached = seen.has(s);
        const active = !errored && lastStage === s && s !== "done";
        const Icon = STAGE_META[s].icon;
        const isLast = idx === STAGE_ORDER.length - 1;

        return (
          <li
            key={s}
            className={cn(
              "relative flex items-start gap-3 px-2 py-2.5",
              !reached && "opacity-40",
              reached && "animate-fade-in-up",
            )}
            style={
              reached ? { animationDelay: `${idx * 50}ms` } : undefined
            }
          >
            {!isLast && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[1.625rem] top-9 h-[calc(100%-1rem)] w-px",
                  reached ? "bg-foreground/15" : "bg-border",
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full",
                active && "bg-foreground text-background",
                reached && !active && "bg-success/15 text-success",
                !reached && "bg-muted text-muted-foreground",
              )}
            >
              {active ? (
                <CircleNotch className="h-3.5 w-3.5 animate-spin" weight="bold" />
              ) : (
                <Icon className="h-3.5 w-3.5" weight={reached ? "bold" : "regular"} />
              )}
            </span>
            <div className="flex-1 min-w-0 pt-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {STAGE_META[s].label}
                </span>
                {active && (
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground animate-pulse">
                    进行中
                  </span>
                )}
              </div>
              {ev?.message && (
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  {ev.message}
                </div>
              )}
            </div>
          </li>
        );
      })}
      {errored && (
        <li className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5">
          <Warning
            className="h-4 w-4 text-destructive mt-0.5 shrink-0"
            weight="fill"
          />
          <div className="flex-1 text-sm text-destructive">
            {events.find((e) => e.stage === "error")?.message ?? "未知错误"}
          </div>
        </li>
      )}
    </ol>
  );
}
