"use client";

import { useState } from "react";
import clsx from "clsx";
import {
  ChevronRight,
  CircleCheck,
  CircleSlash,
  ExternalLink,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import type { ManuscriptScreenResult, ReferenceVerdict } from "@rw/core";
import { EvidenceList } from "./EvidenceList";

type Entry = ManuscriptScreenResult["screenedReferences"][number];

const VERDICT_FILTERS: Array<{ key: ReferenceVerdict | "all"; label: string }> = [
  { key: "all", label: "全部" },
  { key: "confirmed", label: "确认" },
  { key: "likely_match", label: "疑似" },
  { key: "possible_match", label: "可疑" },
  { key: "no_match", label: "清洁" },
];

export function ReferenceTable({ entries }: { entries: Entry[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReferenceVerdict | "all">("all");
  const [openIdx, setOpenIdx] = useState<number | null>(null);

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

  return (
    <div className="surface overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">参考文献比对</h2>
          <span className="badge badge-muted">
            {filtered.length} / {entries.length}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索 标题 / 作者 / DOI"
              className="input !py-1.5 !pl-8 !pr-3 text-sm w-60"
            />
          </div>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5">
            {VERDICT_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={clsx(
                  "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                  filter === f.key
                    ? "bg-white/10 text-white"
                    : "text-slate-400 hover:text-slate-200",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ul className="divide-y divide-white/5">
        {filtered.length === 0 && (
          <li className="px-5 py-10 text-sm text-slate-400 text-center">
            没有匹配的条目
          </li>
        )}
        {filtered.map(({ entry, originalIndex }) => {
          const open = openIdx === originalIndex;
          return (
            <li
              key={originalIndex}
              className={clsx(
                entry.result.verdict === "confirmed" && "row-hit",
                (entry.result.verdict === "likely_match" ||
                  entry.result.verdict === "possible_match") &&
                  "row-review",
              )}
            >
              <button
                onClick={() => setOpenIdx(open ? null : originalIndex)}
                className="w-full text-left px-5 py-3.5 flex items-start gap-3 hover:bg-white/[0.02] transition-colors"
              >
                <span className="text-xs text-slate-500 w-7 shrink-0 mt-0.5 tabular-nums">
                  #{originalIndex + 1}
                </span>
                <VerdictIcon verdict={entry.result.verdict} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-100 line-clamp-2">
                    {entry.reference.title || entry.reference.raw.slice(0, 200)}
                  </div>
                  <div className="text-xs text-slate-400 mt-1 truncate">
                    {entry.reference.authors.length > 0
                      ? entry.reference.authors.slice(0, 3).join(", ") +
                        (entry.reference.authors.length > 3 ? " et al." : "")
                      : ""}
                    {entry.reference.year && (
                      <span className="text-slate-500"> · {entry.reference.year}</span>
                    )}
                    {entry.reference.doi && (
                      <a
                        href={`https://doi.org/${entry.reference.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-slate-500 code ml-2 hover:text-blue-300 inline-flex items-center gap-1"
                      >
                        {entry.reference.doi}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
                <ChevronRight
                  className={clsx(
                    "w-4 h-4 text-slate-500 mt-1 shrink-0 transition-transform",
                    open && "rotate-90",
                  )}
                />
              </button>

              {open && (
                <div className="px-5 pb-5 pl-[3.75rem] fade-in-up">
                  <div className="text-xs text-slate-500 mb-3 leading-relaxed">
                    <span className="text-slate-400 font-medium">原文：</span>
                    {entry.reference.raw}
                  </div>
                  {entry.result.bestCandidate && (
                    <div className="surface-2 p-4 mb-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                          匹配到 RW 记录
                        </span>
                        <span className="code text-xs text-slate-500">
                          score {entry.result.bestCandidate.score.toFixed(2)} · #
                          {entry.result.bestCandidate.record.recordId}
                        </span>
                      </div>
                      <div className="text-sm font-medium text-slate-100">
                        {entry.result.bestCandidate.record.title}
                      </div>
                      <div className="text-xs text-slate-400 mt-1.5 space-y-0.5">
                        <div>
                          <span className="text-slate-500">作者：</span>
                          {entry.result.bestCandidate.record.author}
                        </div>
                        <div>
                          <span className="text-slate-500">期刊：</span>
                          {entry.result.bestCandidate.record.journal}
                        </div>
                        <div>
                          <span className="text-slate-500">类型：</span>
                          {entry.result.bestCandidate.record.retractionNature} · {entry.result.bestCandidate.record.retractionDate}
                        </div>
                        {entry.result.bestCandidate.record.reason && (
                          <div className="text-amber-200/90">
                            <span className="text-slate-500">原因：</span>
                            {entry.result.bestCandidate.record.reason}
                          </div>
                        )}
                      </div>
                    </div>
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
    </div>
  );
}

function VerdictIcon({ verdict }: { verdict: ReferenceVerdict }) {
  const Icon =
    verdict === "confirmed"
      ? ShieldX
      : verdict === "likely_match"
        ? ShieldAlert
        : verdict === "possible_match"
          ? CircleSlash
          : ShieldCheck;
  const colorClass =
    verdict === "confirmed"
      ? "text-rose-400"
      : verdict === "likely_match"
        ? "text-amber-400"
        : verdict === "possible_match"
          ? "text-amber-300"
          : "text-emerald-400";
  return (
    <Icon
      className={clsx("w-4 h-4 mt-0.5 shrink-0", colorClass)}
      strokeWidth={2.1}
    />
  );
}
