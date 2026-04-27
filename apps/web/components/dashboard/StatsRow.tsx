"use client";

import Link from "next/link";
import {
  CheckCircle,
  Files,
  ShieldWarning,
  TrendUp,
  type Icon as PIcon,
} from "@phosphor-icons/react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Stats {
  total: number;
  pass: number;
  review: number;
  fail: number;
  last7d: number;
}

export function StatsRow({ stats }: { stats: Stats }) {
  const hits = stats.fail + stats.review;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard
        icon={Files}
        value={stats.total}
        label="累计稿件"
        href="/history"
      />
      <StatCard
        icon={CheckCircle}
        value={stats.pass}
        label="通过 (PASS)"
        href="/history"
        accent="success"
      />
      <StatCard
        icon={ShieldWarning}
        value={hits}
        label="命中 / 复核"
        href="/history"
        accent={hits > 0 ? "warning" : undefined}
      />
      <StatCard
        icon={TrendUp}
        value={stats.last7d}
        label="近 7 天"
      />
    </div>
  );
}

function StatCard({
  icon: Icon,
  value,
  label,
  href,
  accent,
}: {
  icon: PIcon;
  value: number;
  label: string;
  href?: string;
  accent?: "success" | "warning" | "destructive";
}) {
  const accentCls =
    accent === "success"
      ? "text-success"
      : accent === "warning"
        ? "text-warning"
        : accent === "destructive"
          ? "text-destructive"
          : "text-foreground";
  const inner = (
    <Card
      className={cn(
        "p-4 flex items-center gap-3 transition-colors",
        href && "hover:bg-accent/40 cursor-pointer",
      )}
    >
      <span className="grid h-10 w-10 place-items-center rounded-md bg-muted shrink-0">
        <Icon className={cn("h-5 w-5", accentCls)} weight="duotone" />
      </span>
      <div className="min-w-0">
        <div className={cn("text-2xl font-semibold tabular-nums leading-tight", accentCls)}>
          {value}
        </div>
        <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-0.5">
          {label}
        </div>
      </div>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
