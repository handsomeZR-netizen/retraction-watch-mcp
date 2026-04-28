"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarBlank,
  CheckCircle,
  ChartBar,
  DownloadSimple,
  Files,
  MagnifyingGlass,
  ShieldWarning,
  TrendUp,
  Warning,
  XCircle,
  type Icon as PIcon,
} from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  userId: string | null;
  userLabel: string | null;
  workspaceId: string | null;
  scope: "personal" | "workspace";
  fileName: string;
  fileType: string;
  title: string | null;
  bytes: number;
  verdict: "PASS" | "REVIEW" | "FAIL";
  refsTotal: number;
  refsHit: number;
  authorsHit: number;
  affiliations: string[];
  createdAt: string;
}

interface Resp {
  items: Item[];
  total: number;
  stats: { total: number; pass: number; review: number; fail: number; last30d: number };
  limit: number;
  offset: number;
  nextCursor: string | null;
}

const VERDICT_FILTERS: Array<{ key: "PASS" | "REVIEW" | "FAIL"; label: string; color: string }> = [
  { key: "PASS", label: "PASS", color: "text-success" },
  { key: "REVIEW", label: "REVIEW", color: "text-warning" },
  { key: "FAIL", label: "FAIL", color: "text-destructive" },
];

export default function AnalyticsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Set<"PASS" | "REVIEW" | "FAIL">>(new Set());
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<string[]>([""]);
  const limit = 50;

  const resetPagination = useCallback(() => {
    setPage(0);
    setCursors([""]);
  }, []);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    for (const v of verdicts) params.append("verdict", v);
    if (search.trim()) params.set("search", search.trim());
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to + "T23:59:59").toISOString());
    params.set("limit", String(limit));
    const cursor = cursors[page];
    if (cursor) params.set("cursor", cursor);
    return params.toString();
  }, [verdicts, search, from, to, page, cursors]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/analytics?${queryString}`);
      if (res.status === 403) {
        setError("仅 admin 可访问");
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      setData((await res.json()) as Resp);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleVerdict(v: "PASS" | "REVIEW" | "FAIL") {
    setVerdicts((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
    resetPagination();
  }

  function exportLink(format: "json" | "csv" | "ndjson") {
    const params = new URLSearchParams(queryString);
    params.delete("limit");
    params.delete("offset");
    params.set("format", format);
    return `/api/admin/analytics/export?${params.toString()}`;
  }

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
            <ChartBar className="h-7 w-7" weight="duotone" />
            解析日志分析
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            全局所有用户的稿件解析记录，可过滤导出做后续分析。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={exportLink("json")} download>
              <DownloadSimple className="h-3.5 w-3.5" weight="bold" />
              JSON
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={exportLink("csv")} download>
              <DownloadSimple className="h-3.5 w-3.5" weight="bold" />
              CSV
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={exportLink("ndjson")} download>
              <DownloadSimple className="h-3.5 w-3.5" weight="bold" />
              NDJSON
            </a>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Files} value={data?.stats.total} label="累计稿件" />
        <StatCard icon={CheckCircle} value={data?.stats.pass} label="PASS" accent="success" />
        <StatCard
          icon={ShieldWarning}
          value={data ? data.stats.fail + data.stats.review : null}
          label="命中 (FAIL+REVIEW)"
          accent="warning"
        />
        <StatCard icon={TrendUp} value={data?.stats.last30d} label="近 30 天" />
      </div>

      <Card className="p-3 flex items-center gap-3 flex-wrap">
        <div className="relative w-72">
          <MagnifyingGlass className="h-3.5 w-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPagination();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                resetPagination();
              }
            }}
            placeholder="搜索 文件名 / 标题 / 作者"
            className="pl-9 h-8 text-sm"
          />
        </div>
        <div className="inline-flex items-center gap-1">
          {VERDICT_FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={verdicts.has(f.key) ? "default" : "outline"}
              className="h-7 px-2.5 text-xs"
              onClick={() => toggleVerdict(f.key)}
            >
              <span className={verdicts.has(f.key) ? "" : f.color}>{f.label}</span>
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarBlank className="h-3.5 w-3.5" weight="duotone" />
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              resetPagination();
            }}
            className="h-7 text-xs w-36"
          />
          <span>→</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              resetPagination();
            }}
            className="h-7 text-xs w-36"
          />
        </div>
      </Card>

      {error && (
        <Card className="border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium">时间</th>
                <th className="text-left px-4 py-2 font-medium">用户</th>
                <th className="text-left px-4 py-2 font-medium">文件 / 标题</th>
                <th className="text-left px-4 py-2 font-medium">verdict</th>
                <th className="text-right px-4 py-2 font-medium">引用</th>
                <th className="text-right px-4 py-2 font-medium">命中</th>
                <th className="text-right px-4 py-2 font-medium">作者命中</th>
                <th className="text-left px-4 py-2 font-medium">单位</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && !data && (
                <tr>
                  <td colSpan={8} className="px-4 py-12">
                    <Skeleton className="h-12 w-full" />
                  </td>
                </tr>
              )}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    没有匹配的记录
                  </td>
                </tr>
              )}
              {data?.items.map((it) => (
                <tr key={it.id} className="hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap font-mono">
                    {new Date(it.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    <div className="font-medium truncate max-w-[140px]" title={it.userLabel ?? "-"}>
                      {it.userLabel ?? "-"}
                    </div>
                    <div className="text-[10px] text-muted-foreground uppercase">{it.scope}</div>
                  </td>
                  <td className="px-4 py-2.5 max-w-[280px]">
                    <Link
                      href={`/result/${it.id}`}
                      className="text-sm font-medium hover:underline truncate block"
                      title={it.title ?? it.fileName}
                    >
                      {it.title ?? it.fileName}
                    </Link>
                    <div className="text-[10px] text-muted-foreground font-mono truncate">
                      {it.fileName}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <VerdictBadge v={it.verdict} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                    {it.refsTotal}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2.5 text-right tabular-nums text-xs",
                      it.refsHit > 0 && "text-warning font-semibold",
                    )}
                  >
                    {it.refsHit}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2.5 text-right tabular-nums text-xs",
                      it.authorsHit > 0 && "text-destructive font-semibold",
                    )}
                  >
                    {it.authorsHit}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[200px]">
                    <span className="truncate block" title={it.affiliations.join(" / ")}>
                      {it.affiliations.slice(0, 2).join(", ")}
                      {it.affiliations.length > 2 && " …"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.total > limit && (
          <div className="px-4 py-2.5 border-t border-border flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              第 {page + 1} / {totalPages} 页 · 共 {data.total} 条
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                上一页
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!data.nextCursor}
                onClick={() => {
                  if (!data.nextCursor) return;
                  setCursors((prev) => {
                    const next = prev.slice(0, page + 1);
                    next[page + 1] = data.nextCursor ?? "";
                    return next;
                  });
                  setPage((p) => p + 1);
                }}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  value,
  label,
  accent,
}: {
  icon: PIcon;
  value: number | null | undefined;
  label: string;
  accent?: "success" | "warning";
}) {
  const cls =
    accent === "success" ? "text-success" : accent === "warning" ? "text-warning" : "text-foreground";
  return (
    <Card className="p-4 flex items-center gap-3">
      <span className="grid h-10 w-10 place-items-center rounded-md bg-muted shrink-0">
        <Icon className={cn("h-5 w-5", cls)} weight="duotone" />
      </span>
      <div>
        <div className={cn("text-2xl font-semibold tabular-nums leading-tight", cls)}>
          {value ?? "—"}
        </div>
        <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-0.5">
          {label}
        </div>
      </div>
    </Card>
  );
}

function VerdictBadge({ v }: { v: "PASS" | "REVIEW" | "FAIL" }) {
  if (v === "PASS")
    return (
      <Badge variant="success" className="h-6">
        <CheckCircle className="h-3 w-3" weight="fill" />
        PASS
      </Badge>
    );
  if (v === "REVIEW")
    return (
      <Badge variant="muted" className="h-6 text-warning border-warning/40">
        <Warning className="h-3 w-3" weight="fill" />
        REVIEW
      </Badge>
    );
  return (
    <Badge variant="muted" className="h-6 text-destructive border-destructive/40">
      <XCircle className="h-3 w-3" weight="fill" />
      FAIL
    </Badge>
  );
}
