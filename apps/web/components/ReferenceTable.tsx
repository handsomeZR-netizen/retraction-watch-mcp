"use client";

import { useMemo, useState } from "react";
import {
  CaretRight,
  ArrowSquareOut,
  ArrowsInLineHorizontal,
  ArrowsOutLineHorizontal,
  MagnifyingGlass,
  ShieldWarning,
  ShieldCheck,
  ShieldSlash,
  Question,
  type Icon as PIcon,
} from "@phosphor-icons/react";
import type { ManuscriptScreenResult, ReferenceVerdict } from "@rw/core";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EvidenceList } from "./EvidenceList";
import { cn } from "@/lib/utils";

type Entry = ManuscriptScreenResult["screenedReferences"][number];

const FILTERS: Array<{ key: ReferenceVerdict | "all"; label: string }> = [
  { key: "all", label: "全部" },
  { key: "confirmed", label: "确认" },
  { key: "likely_match", label: "疑似" },
  { key: "possible_match", label: "可疑" },
  { key: "no_match", label: "清洁" },
];

function isHit(v: ReferenceVerdict): boolean {
  return v === "confirmed" || v === "likely_match" || v === "possible_match";
}

export function ReferenceTable({ entries }: { entries: Entry[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReferenceVerdict | "all">("all");

  const initialOpen = useMemo(() => {
    const s = new Set<number>();
    entries.forEach((e, i) => {
      if (isHit(e.result.verdict)) s.add(i);
    });
    return s;
  }, [entries]);
  const [openSet, setOpenSet] = useState<Set<number>>(initialOpen);

  function toggle(i: number) {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const filtered = entries
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .filter(({ entry }) => {
      if (filter !== "all" && entry.result.verdict !== filter) return false;
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      const ref = entry.reference;
      return (
        (ref.title ?? "").toLowerCase().includes(q) ||
        ref.authors.some((a) => a.toLowerCase().includes(q)) ||
        (ref.doi ?? "").toLowerCase().includes(q) ||
        ref.raw.toLowerCase().includes(q)
      );
    });

  const visibleIdx = filtered.map((f) => f.originalIndex);
  const visibleAllOpen =
    visibleIdx.length > 0 && visibleIdx.every((i) => openSet.has(i));

  function expandAll() {
    setOpenSet(new Set(visibleIdx));
  }
  function collapseAll() {
    setOpenSet(new Set());
  }

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-serif text-lg font-semibold tracking-tight">
            参考文献比对
          </h2>
          <Badge variant="muted" className="tabular-nums">
            {filtered.length} / {entries.length}
          </Badge>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative w-56">
            <MagnifyingGlass className="h-3.5 w-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              id="reference-search"
              name="referenceSearch"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索 标题 / 作者 / DOI"
              className="pl-9 h-8 text-sm"
            />
          </div>
          <div className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5">
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant="ghost"
                onClick={() => setFilter(f.key)}
                className={cn(
                  "h-7 px-2.5 text-xs rounded-sm",
                  filter === f.key
                    ? "bg-background text-foreground shadow-sm hover:bg-background"
                    : "text-muted-foreground hover:bg-transparent",
                )}
              >
                {f.label}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={visibleAllOpen ? collapseAll : expandAll}
            className="h-7 px-2.5 text-xs"
            disabled={visibleIdx.length === 0}
            title={visibleAllOpen ? "全部折叠" : "全部展开"}
          >
            {visibleAllOpen ? (
              <ArrowsInLineHorizontal className="h-3.5 w-3.5" weight="bold" />
            ) : (
              <ArrowsOutLineHorizontal className="h-3.5 w-3.5" weight="bold" />
            )}
            {visibleAllOpen ? "折叠" : "展开"}
          </Button>
        </div>
      </div>

      <ul className="divide-y divide-border">
        {filtered.length === 0 && (
          <li className="px-5 py-12 text-sm text-muted-foreground text-center">
            没有匹配的条目
          </li>
        )}
        {filtered.map(({ entry, originalIndex }) => {
          const open = openSet.has(originalIndex);
          return (
            <li
              key={originalIndex}
              className={cn(
                entry.result.verdict === "confirmed" &&
                  "bg-destructive/[0.03] border-l-2 border-l-destructive/50",
                (entry.result.verdict === "likely_match" ||
                  entry.result.verdict === "possible_match") &&
                  "bg-warning/[0.03] border-l-2 border-l-warning/50",
              )}
            >
              <button
                onClick={() => toggle(originalIndex)}
                aria-expanded={open}
                className="w-full text-left px-5 py-3.5 flex items-start gap-3 hover:bg-accent/40 transition-colors focus-visible:outline-none focus-visible:bg-accent/40"
              >
                <span className="text-[11px] text-muted-foreground w-7 shrink-0 mt-1 tabular-nums font-mono small-caps">
                  {String(originalIndex + 1).padStart(2, "0")}
                </span>
                <VerdictIcon verdict={entry.result.verdict} />
                <div className="flex-1 min-w-0">
                  <div className="font-serif text-[0.95rem] font-medium leading-snug line-clamp-2 text-foreground">
                    {entry.reference.title || entry.reference.raw.slice(0, 200)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 truncate">
                    {entry.reference.authors.length > 0
                      ? entry.reference.authors.slice(0, 3).join(", ") +
                        (entry.reference.authors.length > 3 ? " et al." : "")
                      : ""}
                    {entry.reference.year && (
                      <span> · {entry.reference.year}</span>
                    )}
                    {entry.reference.doi && (
                      <a
                        href={`https://doi.org/${entry.reference.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono ml-2 hover:text-foreground inline-flex items-center gap-1"
                      >
                        {entry.reference.doi}
                        <ArrowSquareOut className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
                <CaretRight
                  className={cn(
                    "h-4 w-4 text-muted-foreground mt-1 shrink-0 transition-transform",
                    open && "rotate-90",
                  )}
                  weight="bold"
                />
              </button>

              {open && (
                <div className="px-5 pb-5 pl-[3.75rem] animate-fade-in-up">
                  <div className="font-serif text-[0.85rem] text-muted-foreground mb-3 leading-relaxed">
                    <span className="text-foreground font-medium small-caps mr-1.5 text-[11px]">
                      原文
                    </span>
                    {entry.reference.raw}
                  </div>
                  {entry.result.bestCandidate && (
                    <Card className="p-4 mb-3 bg-accent/40 border-primary/15">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="small-caps text-[11px] text-primary font-semibold">
                          匹配到 RW 记录
                        </span>
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">
                          score {entry.result.bestCandidate.score.toFixed(2)} · #
                          {entry.result.bestCandidate.record.recordId}
                        </span>
                      </div>
                      <div className="font-serif text-[0.95rem] font-medium leading-snug text-foreground">
                        {entry.result.bestCandidate.record.title}
                      </div>
                      <div className="text-xs text-muted-foreground mt-2 space-y-1">
                        <div>
                          <span className="text-foreground/70 font-medium">作者：</span>
                          {entry.result.bestCandidate.record.author}
                        </div>
                        <div>
                          <span className="text-foreground/70 font-medium">期刊：</span>
                          {entry.result.bestCandidate.record.journal}
                        </div>
                        <div>
                          <span className="text-foreground/70 font-medium">类型：</span>
                          {entry.result.bestCandidate.record.retractionNature} ·{" "}
                          {entry.result.bestCandidate.record.retractionDate}
                        </div>
                        {entry.result.bestCandidate.record.reason && (
                          <div className="text-warning">
                            <span className="text-foreground/70 font-medium">原因：</span>
                            {entry.result.bestCandidate.record.reason}
                          </div>
                        )}
                      </div>
                    </Card>
                  )}
                  {entry.result.evidence.length > 0 && (
                    <EvidenceList evidence={entry.result.evidence} />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function VerdictIcon({ verdict }: { verdict: ReferenceVerdict }) {
  const map: Record<ReferenceVerdict, { Icon: PIcon; color: string }> = {
    confirmed: { Icon: ShieldSlash, color: "text-destructive" },
    likely_match: { Icon: ShieldWarning, color: "text-warning" },
    possible_match: { Icon: Question, color: "text-warning/80" },
    no_match: { Icon: ShieldCheck, color: "text-success" },
  };
  const { Icon, color } = map[verdict];
  return (
    <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", color)} weight="duotone" />
  );
}
