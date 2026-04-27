"use client";

import Link from "next/link";
import {
  CaretRight,
  CheckCircle,
  CircleNotch,
  ClockCounterClockwise,
  FileText,
  Warning,
  XCircle,
  type Icon as PIcon,
} from "@phosphor-icons/react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  fileName: string;
  fileType: string;
  uploadedAt: string;
  status: "parsing" | "done" | "error";
  verdict: "PASS" | "REVIEW" | "FAIL" | null;
  title: string | null;
  totals: Record<string, number> | null;
}

export function RecentList({ items }: { items: Item[] }) {
  if (items.length === 0) {
    return (
      <Card className="p-8 text-center">
        <FileText className="h-7 w-7 mx-auto text-muted-foreground mb-3" weight="duotone" />
        <h3 className="text-sm font-medium mb-1">还没有解析过稿件</h3>
        <p className="text-xs text-muted-foreground">
          把 PDF / Word / LaTeX 文件拖到上方开始第一次筛查
        </p>
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <header className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClockCounterClockwise className="h-4 w-4 text-muted-foreground" weight="duotone" />
          <h2 className="text-sm font-semibold">最近解析</h2>
        </div>
        <Link
          href="/history"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          查看全部 <CaretRight className="h-3 w-3" weight="bold" />
        </Link>
      </header>
      <ul className="divide-y divide-border">
        {items.map((it) => (
          <li key={it.id}>
            <Link
              href={it.status === "done" ? `/result/${it.id}` : "/history"}
              className="px-4 py-3 flex items-center gap-3 hover:bg-accent/40 transition-colors"
            >
              <StatusIcon item={it} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {it.title ?? it.fileName}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
                  <span className="font-mono">{it.fileType.toUpperCase()}</span>
                  <span>·</span>
                  <span>{relativeTime(it.uploadedAt)}</span>
                  {it.totals && (
                    <>
                      <span>·</span>
                      <span>
                        {it.totals.references} 条引用
                        {it.totals.confirmed + it.totals.likely > 0 && (
                          <span className="text-warning ml-1">
                            · {it.totals.confirmed + it.totals.likely} 命中
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <CaretRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" weight="bold" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function StatusIcon({ item }: { item: Item }) {
  if (item.status === "parsing") {
    return (
      <CircleNotch
        className="h-4 w-4 text-muted-foreground animate-spin shrink-0"
        weight="bold"
      />
    );
  }
  if (item.status === "error") {
    return <Warning className="h-4 w-4 text-destructive shrink-0" weight="duotone" />;
  }
  const map: Record<string, { Icon: PIcon; color: string }> = {
    PASS: { Icon: CheckCircle, color: "text-success" },
    REVIEW: { Icon: Warning, color: "text-warning" },
    FAIL: { Icon: XCircle, color: "text-destructive" },
  };
  const m = item.verdict ? map[item.verdict] : null;
  if (!m) return <FileText className="h-4 w-4 text-muted-foreground shrink-0" weight="duotone" />;
  return <m.Icon className={cn("h-4 w-4 shrink-0", m.color)} weight="duotone" />;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return new Date(iso).toLocaleDateString();
}
