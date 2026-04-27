"use client";

import { CheckCircle, Warning, XCircle } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Verdict = "PASS" | "REVIEW" | "FAIL";

const META: Record<
  Verdict,
  {
    label: string;
    sub: string;
    badge: "success" | "warning" | "destructive";
    icon: Icon;
    ringClass: string;
  }
> = {
  PASS: {
    label: "通过",
    sub: "未发现引用了撤稿数据库中的文献",
    badge: "success",
    icon: CheckCircle,
    ringClass: "bg-success/10 text-success",
  },
  REVIEW: {
    label: "待复核",
    sub: "存在弱匹配；建议人工复核",
    badge: "warning",
    icon: Warning,
    ringClass: "bg-warning/10 text-warning",
  },
  FAIL: {
    label: "不通过",
    sub: "至少 1 条参考文献已确认为撤稿文献",
    badge: "destructive",
    icon: XCircle,
    ringClass: "bg-destructive/10 text-destructive",
  },
};

export function VerdictCard({
  verdict,
  totals,
}: {
  verdict: Verdict;
  totals: {
    references: number;
    confirmed: number;
    likely: number;
    possible: number;
    clean: number;
  };
}) {
  const m = META[verdict];
  const Icon = m.icon;
  return (
    <div className="grid lg:grid-cols-[auto_1fr] gap-4 items-stretch">
      <Card className="px-6 py-5 flex flex-col items-center justify-center min-w-[210px]">
        <div
          className={cn(
            "grid h-14 w-14 place-items-center rounded-full",
            m.ringClass,
          )}
        >
          <Icon className="h-8 w-8" weight="duotone" />
        </div>
        <Badge variant={m.badge} className="mt-3 text-[0.7rem] uppercase tracking-[0.08em] py-1 px-3">
          {verdict}
        </Badge>
        <div className="text-base font-medium mt-3">{m.label}</div>
        <div className="text-xs text-muted-foreground mt-1 text-center max-w-[180px]">
          {m.sub}
        </div>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="参考文献" value={totals.references} accent="muted" />
        <Tile
          label="确认命中"
          value={totals.confirmed}
          accent={totals.confirmed > 0 ? "destructive" : "muted"}
        />
        <Tile
          label="疑似"
          value={totals.likely + totals.possible}
          accent={totals.likely + totals.possible > 0 ? "warning" : "muted"}
        />
        <Tile label="清洁" value={totals.clean} accent="success" />
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "success" | "warning" | "destructive" | "muted";
}) {
  const colorClass = {
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
    muted: "text-foreground",
  }[accent];
  return (
    <Card className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </div>
      <div className={cn("text-3xl font-semibold mt-1 tabular-nums", colorClass)}>
        {value}
      </div>
    </Card>
  );
}
