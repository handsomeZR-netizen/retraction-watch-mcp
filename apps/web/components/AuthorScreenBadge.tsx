"use client";

import { useState } from "react";
import {
  ArrowSquareOut,
  CaretRight,
  CheckCircle,
  ShieldSlash,
  ShieldWarning,
  Question,
  type Icon as PIcon,
} from "@phosphor-icons/react";
import type { AuthorScreenResult, MatchVerdict, RwRecord } from "@rw/core";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const META: Record<
  MatchVerdict,
  { Icon: PIcon; label: string; chipCls: string; bannerCls: string; barCls: string; headline: string }
> = {
  confirmed: {
    Icon: ShieldSlash,
    label: "涉及撤稿史",
    chipCls: "text-destructive border-destructive/40",
    bannerCls: "bg-destructive/10 text-destructive",
    barCls: "border-l-destructive",
    headline: "该作者已被确认在 Retraction Watch 库的撤稿记录中",
  },
  likely_match: {
    Icon: ShieldWarning,
    label: "建议复核",
    chipCls: "text-warning border-warning/40",
    bannerCls: "bg-warning/10 text-warning",
    barCls: "border-l-warning",
    headline: "该作者疑似匹配 Retraction Watch 的撤稿记录",
  },
  possible_match: {
    Icon: Question,
    label: "低置信疑似",
    chipCls: "text-warning/80 border-warning/30",
    bannerCls: "bg-warning/10 text-warning/90",
    barCls: "border-l-warning/60",
    headline: "该作者可能与撤稿记录相关",
  },
  no_match: {
    Icon: CheckCircle,
    label: "已比对",
    chipCls: "text-muted-foreground border-border/60",
    bannerCls: "bg-muted text-muted-foreground",
    barCls: "border-l-border",
    headline: "未在 Retraction Watch 库中发现历史撤稿记录",
  },
};

export function AuthorScreenBadge({ result }: { result: AuthorScreenResult }) {
  const [open, setOpen] = useState(false);
  const meta = META[result.verdict] ?? META.no_match;
  const { Icon, label, chipCls } = meta;
  const record = result.matchedRecord;
  const isHit = result.verdict !== "no_match";

  return (
    <div className="space-y-2 w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center"
      >
        <Badge
          variant="muted"
          className={cn(
            "h-6 cursor-pointer transition-colors",
            chipCls,
            open && "bg-accent",
            !open && "hover:bg-accent",
          )}
        >
          <Icon className="h-3 w-3" weight="fill" />
          <span className="text-[11px]">{label}</span>
          <CaretRight
            className={cn("h-2.5 w-2.5 ml-0.5 transition-transform", open && "rotate-90")}
            weight="bold"
          />
        </Badge>
      </button>
      {open && (
        <Card className="p-4 mt-2 bg-card animate-fade-in-up space-y-3">
          <Banner Icon={Icon} text={meta.headline} cls={meta.bannerCls} />

          {!isHit && (
            <div className="text-xs text-muted-foreground leading-relaxed">
              已在 Retraction Watch 数据库中检索过该作者，未发现任何历史撤稿记录。
            </div>
          )}

          {record && <RetractionDetail record={record} authorName={result.author.name} barCls={meta.barCls} />}

          {record && (
            <div className="border-t border-border/60 pt-2 text-[10px] text-muted-foreground font-mono flex items-center justify-between">
              <span>RW #{record.recordId}</span>
              <span>匹配置信度 {result.score.toFixed(2)}</span>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Banner({ Icon, text, cls }: { Icon: PIcon; text: string; cls: string }) {
  return (
    <div className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium", cls)}>
      <Icon className="h-3.5 w-3.5 shrink-0" weight="fill" />
      <span>{text}</span>
    </div>
  );
}

function RetractionDetail({
  record,
  authorName,
  barCls,
}: {
  record: RwRecord;
  authorName: string;
  barCls: string;
}) {
  const year = parseYear(record.retractionDate) ?? parseYear(record.originalPaperDate);
  const reasons = (record.reason ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const coAuthors = (record.author ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const doiUrl = record.originalPaperDoi
    ? `https://doi.org/${record.originalPaperDoi}`
    : record.retractionDoi
      ? `https://doi.org/${record.retractionDoi}`
      : null;

  return (
    <div className="space-y-3">
      <div className={cn("border-l-2 pl-3", barCls)}>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
          撤稿论文
        </div>
        <div className="text-sm font-semibold leading-snug line-clamp-3">
          {record.title}
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-1.5 text-[11px] text-muted-foreground">
          {record.journal && <span>{record.journal}</span>}
          {year && (
            <>
              <span>·</span>
              <span>{year}</span>
            </>
          )}
          {record.retractionNature && (
            <>
              <span>·</span>
              <span>{record.retractionNature}</span>
            </>
          )}
          {doiUrl && (
            <a
              href={doiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-foreground hover:underline ml-auto"
            >
              查看原文 <ArrowSquareOut className="h-3 w-3" weight="bold" />
            </a>
          )}
        </div>
      </div>

      {reasons.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            撤稿原因
          </div>
          <div className="flex flex-wrap gap-1.5">
            {reasons.map((r, i) => (
              <span
                key={i}
                className="text-[11px] px-2 py-0.5 rounded bg-destructive/8 text-destructive/90 border border-destructive/20"
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      )}

      {coAuthors.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            撤稿论文作者
          </div>
          <div className="flex flex-wrap gap-1.5">
            {coAuthors.slice(0, 6).map((a, i) => {
              const isSelf = matchesAuthor(a, authorName);
              return (
                <span
                  key={i}
                  className={cn(
                    "text-[11px] px-2 py-0.5 rounded border",
                    isSelf
                      ? "bg-warning/15 text-warning border-warning/40 font-medium"
                      : "bg-muted/60 text-muted-foreground border-border/60",
                  )}
                >
                  {a}
                </span>
              );
            })}
            {coAuthors.length > 6 && (
              <span className="text-[11px] text-muted-foreground self-center">
                等 {coAuthors.length} 位
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function parseYear(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/(19|20)\d{2}/);
  return m ? m[0] : null;
}

function matchesAuthor(rwAuthor: string, queryName: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[.,;:'"`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const a = norm(rwAuthor);
  const q = norm(queryName);
  if (!a || !q) return false;
  return a === q || a.includes(q) || q.includes(a);
}
