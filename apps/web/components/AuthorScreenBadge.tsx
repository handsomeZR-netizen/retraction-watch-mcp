"use client";

import { useState } from "react";
import {
  CaretRight,
  ShieldSlash,
  ShieldWarning,
  Question,
  type Icon as PIcon,
} from "@phosphor-icons/react";
import type { AuthorScreenResult, MatchVerdict } from "@rw/core";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EvidenceList } from "./EvidenceList";
import { cn } from "@/lib/utils";

const META: Partial<
  Record<MatchVerdict, { Icon: PIcon; label: string; cls: string; ringCls: string }>
> = {
  confirmed: {
    Icon: ShieldSlash,
    label: "涉及撤稿史",
    cls: "text-destructive border-destructive/40",
    ringCls: "ring-destructive/30",
  },
  likely_match: {
    Icon: ShieldWarning,
    label: "建议复核",
    cls: "text-warning border-warning/40",
    ringCls: "ring-warning/30",
  },
  possible_match: {
    Icon: Question,
    label: "低置信疑似",
    cls: "text-warning/80 border-warning/30",
    ringCls: "ring-warning/20",
  },
};

export function AuthorScreenBadge({ result }: { result: AuthorScreenResult }) {
  const [open, setOpen] = useState(false);
  const meta = META[result.verdict];
  if (!meta) return null;
  const { Icon, label, cls } = meta;
  const record = result.matchedRecord;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center"
      >
        <Badge variant="muted" className={cn("h-6 cursor-pointer hover:bg-accent transition-colors", cls)}>
          <Icon className="h-3 w-3" weight="fill" />
          <span className="text-[11px]">{label}</span>
          <CaretRight
            className={cn("h-2.5 w-2.5 ml-0.5 transition-transform", open && "rotate-90")}
            weight="bold"
          />
        </Badge>
      </button>
      {open && (
        <Card className="p-3 mt-2 bg-accent/30 animate-fade-in-up text-xs space-y-2">
          {record && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                匹配 RW 记录 #{record.recordId} · score {result.score.toFixed(2)}
              </div>
              <div className="text-sm font-medium leading-snug">{record.title}</div>
              <div className="text-muted-foreground leading-relaxed">
                <span className="text-foreground/70 font-medium">作者：</span>
                {record.author}
              </div>
              <div className="text-muted-foreground">
                <span className="text-foreground/70 font-medium">类型：</span>
                {record.retractionNature} · {record.retractionDate}
              </div>
              {record.reason && (
                <div className="text-warning">
                  <span className="text-foreground/70 font-medium">原因：</span>
                  {record.reason}
                </div>
              )}
            </div>
          )}
          {result.evidence.length > 0 && <EvidenceList evidence={result.evidence} />}
        </Card>
      )}
    </div>
  );
}
