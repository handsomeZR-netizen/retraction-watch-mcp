"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowSquareOut,
  CalendarBlank,
  CheckCircle,
  ClockCounterClockwise,
  DownloadSimple,
  Trash,
  Warning,
  XCircle,
  type Icon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  fileName: string;
  fileType: string;
  bytes: number;
  uploadedAt: string;
  status: "parsing" | "done" | "error";
  verdict: "PASS" | "REVIEW" | "FAIL" | null;
  title: string | null;
  totals: Record<string, number> | null;
  error: string | null;
}

const VERDICT_ICON: Record<NonNullable<Item["verdict"]>, { icon: Icon; color: string }> = {
  PASS: { icon: CheckCircle, color: "text-success" },
  REVIEW: { icon: Warning, color: "text-warning" },
  FAIL: { icon: XCircle, color: "text-destructive" },
};

export default function HistoryPage() {
  const [items, setItems] = useState<Item[] | null>(null);

  async function load() {
    const res = await fetch("/api/manuscripts");
    if (!res.ok) {
      toast.error("加载失败");
      return;
    }
    const j = (await res.json()) as { items: Item[] };
    setItems(j.items);
  }

  useEffect(() => {
    void load();
  }, []);

  async function remove(id: string) {
    if (!confirm("确认删除这条历史记录？此操作会同时删除磁盘上的稿件副本。")) return;
    const res = await fetch(`/api/manuscripts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("删除失败");
      return;
    }
    toast.success("已删除");
    setItems((prev) => prev?.filter((it) => it.id !== id) ?? prev);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
            <ClockCounterClockwise className="h-7 w-7" weight="duotone" />
            历史记录
          </h1>
          <p className="text-sm text-muted-foreground">
            只显示你自己上传的稿件。点击进入详情页查看证据明细，或直接下载报告。
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href="/api/manuscripts/export">
            <DownloadSimple className="h-4 w-4" weight="bold" />
            导出全部 (NDJSON)
          </a>
        </Button>
      </header>

      {!items && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {items && items.length === 0 && (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          还没有上传过稿件。
          <Link href="/" className="ml-1 text-foreground underline">
            去首页上传
          </Link>
        </Card>
      )}

      {items && items.length > 0 && (
        <div className="space-y-2">
          {items.map((it) => {
            const VerdictIcon = it.verdict ? VERDICT_ICON[it.verdict].icon : null;
            const verdictColor = it.verdict ? VERDICT_ICON[it.verdict].color : "";
            return (
              <Card
                key={it.id}
                className={cn(
                  "p-4 flex items-center gap-4 transition-colors hover:bg-accent/30",
                  it.status === "error" && "border-destructive/50",
                )}
              >
                <span className="grid h-10 w-10 place-items-center rounded-md bg-muted text-foreground shrink-0">
                  {VerdictIcon ? (
                    <VerdictIcon className={cn("h-5 w-5", verdictColor)} weight="duotone" />
                  ) : (
                    <ClockCounterClockwise className="h-5 w-5 text-muted-foreground" />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <Link
                    href={it.status === "done" ? `/result/${it.id}` : "#"}
                    className={cn(
                      "block truncate font-medium",
                      it.status === "done" ? "hover:underline" : "pointer-events-none",
                    )}
                  >
                    {it.title ?? it.fileName}
                  </Link>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarBlank className="h-3 w-3" weight="duotone" />
                      {new Date(it.uploadedAt).toLocaleString()}
                    </span>
                    <span className="font-mono uppercase">{it.fileType}</span>
                    <span className="font-mono">
                      {(it.bytes / 1024).toFixed(1)} KB
                    </span>
                    {it.totals && (
                      <span className="font-mono">
                        {it.totals.references} refs
                        {it.totals.confirmed > 0 && ` · ${it.totals.confirmed} hits`}
                      </span>
                    )}
                  </div>
                  {it.error && (
                    <div className="text-xs text-destructive mt-1 truncate">
                      错误: {it.error}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {it.verdict && <Badge variant={verdictBadge(it.verdict)}>{it.verdict}</Badge>}
                  {it.status === "parsing" && <Badge variant="muted">解析中</Badge>}
                  {it.status === "error" && <Badge variant="destructive">出错</Badge>}
                  {it.status === "done" && (
                    <>
                      <Button variant="ghost" size="icon" asChild>
                        <a
                          href={`/api/report/${it.id}?format=download`}
                          aria-label="下载 JSON"
                        >
                          <DownloadSimple className="h-4 w-4" weight="bold" />
                        </a>
                      </Button>
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/result/${it.id}`} aria-label="查看详情">
                          <ArrowSquareOut className="h-4 w-4" weight="bold" />
                        </Link>
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(it.id)}
                    className="text-destructive hover:text-destructive"
                    aria-label="删除"
                  >
                    <Trash className="h-4 w-4" weight="duotone" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function verdictBadge(v: NonNullable<Item["verdict"]>): "success" | "warning" | "destructive" {
  if (v === "PASS") return "success";
  if (v === "REVIEW") return "warning";
  return "destructive";
}
