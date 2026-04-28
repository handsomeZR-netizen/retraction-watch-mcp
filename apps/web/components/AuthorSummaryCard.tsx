"use client";

import { ShieldCheck, ShieldSlash, ShieldWarning, UsersThree } from "@phosphor-icons/react";
import type { AuthorScreenResult } from "@rw/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  authors: AuthorScreenResult[];
}

export function AuthorSummaryCard({ authors }: Props) {
  if (authors.length === 0) return null;
  const total = authors.length;
  let confirmed = 0;
  let likely = 0;
  let possible = 0;
  let clean = 0;
  for (const a of authors) {
    if (a.verdict === "confirmed") confirmed += 1;
    else if (a.verdict === "likely_match") likely += 1;
    else if (a.verdict === "possible_match") possible += 1;
    else clean += 1;
  }
  const reviewable = likely + possible;
  const hits = authors.filter(
    (a) =>
      a.verdict === "confirmed" ||
      a.verdict === "likely_match" ||
      a.verdict === "possible_match",
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <UsersThree className="h-4 w-4 text-muted-foreground" weight="duotone" />
          作者撤稿史比对
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          <Tile label="已比对" value={total} accent="muted" />
          <Tile
            label="确认命中"
            value={confirmed}
            accent={confirmed > 0 ? "destructive" : "muted"}
          />
          <Tile
            label="待复核"
            value={reviewable}
            accent={reviewable > 0 ? "warning" : "muted"}
          />
          <Tile label="干净" value={clean} accent="success" />
        </div>
        {hits.length > 0 ? (
          <ul className="text-xs space-y-1.5">
            {hits.slice(0, 4).map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <HitIcon verdict={a.verdict} />
                <span className="flex-1 min-w-0">
                  <span className="font-medium text-foreground">{a.author.name}</span>
                  {a.matchedRecord?.title && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {truncate(a.matchedRecord.title, 80)}
                    </span>
                  )}
                </span>
              </li>
            ))}
            {hits.length > 4 && (
              <li className="text-[11px] text-muted-foreground italic">
                还有 {hits.length - 4} 位作者命中，详见下方稿件作者列表。
              </li>
            )}
          </ul>
        ) : (
          <div className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-success" weight="duotone" />
            所有作者均未在 Retraction Watch 库中发现历史撤稿记录。
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HitIcon({ verdict }: { verdict: AuthorScreenResult["verdict"] }) {
  if (verdict === "confirmed") {
    return <ShieldSlash className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" weight="fill" />;
  }
  return <ShieldWarning className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" weight="fill" />;
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
    <Card className="p-3 min-w-0">
      <div className="text-[10px] tracking-wide text-muted-foreground font-medium whitespace-nowrap overflow-hidden text-ellipsis">
        {label}
      </div>
      <div className={cn("text-2xl font-semibold mt-1 tabular-nums", colorClass)}>
        {value}
      </div>
    </Card>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
