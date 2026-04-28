"use client";

import { use, useEffect, useState } from "react";
import {
  CalendarBlank,
  CloudArrowDown,
  Eye,
  ShieldCheck,
} from "@phosphor-icons/react";
import type { ManuscriptScreenResult } from "@rw/core";
import { AuthorScreenBadge } from "@/components/AuthorScreenBadge";
import { AuthorSummaryCard } from "@/components/AuthorSummaryCard";
import { Card } from "@/components/ui/card";
import { ReferenceTable } from "@/components/ReferenceTable";
import { Separator } from "@/components/ui/separator";
import { VerdictCard } from "@/components/VerdictCard";

interface ShareData {
  manuscriptId: string;
  fileName: string;
  fileType: string;
  bytes: number;
  expiresAt: string;
  result: ManuscriptScreenResult;
}

export default function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/share/${token}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        return (await r.json()) as ShareData;
      })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [token]);

  if (error) {
    return (
      <div className="space-y-4 py-12 text-center">
        <h1 className="text-2xl font-semibold">分享链接不可用</h1>
        <p className="text-muted-foreground text-sm">
          链接可能已被撤销、过期或不存在。如需查看请联系发送方重新生成。
        </p>
        <p className="text-[11px] text-muted-foreground font-mono">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="py-16 text-center text-muted-foreground text-sm">
        加载中…
      </div>
    );
  }

  const { result } = data;

  return (
    <div className="space-y-6 py-4">
      <Card className="px-4 py-2.5 flex items-center justify-between gap-3 bg-muted/40 border-dashed text-xs">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Eye className="h-3.5 w-3.5" weight="duotone" />
          只读分享视图
        </span>
        <span className="text-muted-foreground">
          有效期至 {new Date(data.expiresAt).toLocaleString()}
        </span>
      </Card>

      <Card className="p-6 space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground mb-1 truncate font-mono">
              {data.fileName}
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight leading-tight">
              {result.metadata.title ?? (
                <span className="text-muted-foreground">(未识别标题)</span>
              )}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalendarBlank className="h-3.5 w-3.5" weight="duotone" />
                {new Date(result.generatedAt).toLocaleString()}
              </span>
              <span className="font-mono">{result.policyVersion}</span>
              <span className="font-mono uppercase">{result.fileType}</span>
            </div>
          </div>
        </div>

        <Separator />

        <VerdictCard verdict={result.verdict} totals={result.totals} />
      </Card>

      {result.screenedAuthors && result.screenedAuthors.length > 0 && (
        <AuthorSummaryCard authors={result.screenedAuthors} />
      )}

      {result.metadata.authors.length > 0 && (
        <Card className="p-5 space-y-2">
          <h2 className="text-base font-medium">稿件作者</h2>
          <ul className="space-y-2">
            {result.metadata.authors.map((author, i) => {
              const screen = result.screenedAuthors?.[i];
              return (
                <li
                  key={i}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-md border bg-card"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-muted text-foreground text-sm font-semibold shrink-0">
                    {(author.name?.charAt(0) ?? "?").toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{author.name}</span>
                      {screen && <AuthorScreenBadge result={screen} />}
                    </div>
                    {author.affiliation && (
                      <div className="text-xs text-muted-foreground truncate">
                        {author.affiliation}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <ReferenceTable entries={result.screenedReferences} />

      <Card className="p-5 text-xs text-muted-foreground leading-relaxed">
        <div className="flex items-start gap-2">
          <CloudArrowDown
            className="h-4 w-4 text-warning mt-0.5 shrink-0"
            weight="fill"
          />
          <div>
            <span className="text-foreground font-medium">免责声明：</span>{" "}
            {result.consequentialUseWarning}
          </div>
        </div>
      </Card>

      <div className="text-center text-[11px] text-muted-foreground inline-flex items-center justify-center gap-1.5 w-full">
        <ShieldCheck className="h-3 w-3" weight="duotone" />
        本视图仅显示筛查结果摘要，不可编辑、不显示备注或审稿人信息。
      </div>
    </div>
  );
}
