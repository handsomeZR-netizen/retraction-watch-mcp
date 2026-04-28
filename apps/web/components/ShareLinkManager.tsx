"use client";

import { useEffect, useState } from "react";
import { Copy, LinkSimple, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ShareEntry {
  token: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  active: boolean;
}

const TTL_OPTIONS = [
  { label: "1 天", hours: 24 },
  { label: "7 天", hours: 24 * 7 },
  { label: "30 天", hours: 24 * 30 },
];

export function ShareLinkManager({ manuscriptId }: { manuscriptId: string }) {
  const [shares, setShares] = useState<ShareEntry[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const res = await fetch(`/api/manuscripts/${manuscriptId}/shares`);
      if (res.ok) {
        const j = (await res.json()) as { shares: ShareEntry[] };
        setShares(j.shares);
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manuscriptId]);

  const create = async (hours: number) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/manuscripts/${manuscriptId}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttlHours: hours }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const { token } = (await res.json()) as { token: string };
      const url = `${window.location.origin}/share/${token}`;
      try {
        await navigator.clipboard.writeText(url);
        toast.success("分享链接已复制到剪贴板");
      } catch {
        toast.success("分享链接已生成");
      }
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成分享链接失败");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (token: string) => {
    if (!confirm("撤销后该链接立即失效，已转发也无法访问。继续？")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/manuscripts/shares/${token}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const j = (await res.json()) as { shares: ShareEntry[] };
        setShares(j.shares);
        toast.success("已撤销");
      }
    } finally {
      setBusy(false);
    }
  };

  const copy = async (token: string) => {
    const url = `${window.location.origin}/share/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("浏览器拒绝了剪贴板访问，请手动复制：" + url);
    }
  };

  const active = shares?.filter((s) => s.active) ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <LinkSimple className="h-4 w-4 text-muted-foreground" weight="duotone" />
          只读分享链接
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground leading-relaxed">
          生成只读 URL 给非成员查看本结果（隐藏备注、审稿人）。可随时撤销。
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">生成新链接（有效期）：</span>
          {TTL_OPTIONS.map((opt) => (
            <Button
              key={opt.hours}
              size="sm"
              variant="outline"
              onClick={() => create(opt.hours)}
              disabled={busy}
            >
              {opt.label}
            </Button>
          ))}
        </div>

        {active.length > 0 && (
          <ul className="space-y-1 mt-2">
            {active.map((s) => (
              <li
                key={s.token}
                className="flex items-center gap-2 px-2.5 py-2 rounded-md border bg-card text-xs"
              >
                <code className="flex-1 min-w-0 truncate font-mono text-[11px]">
                  /share/{s.token.slice(0, 12)}…
                </code>
                <span className="text-muted-foreground whitespace-nowrap">
                  访问 {s.viewCount} 次 · 至 {new Date(s.expiresAt).toLocaleDateString()}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copy(s.token)}
                  title="复制链接"
                  disabled={busy}
                >
                  <Copy className="h-3.5 w-3.5" weight="bold" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => revoke(s.token)}
                  title="撤销"
                  disabled={busy}
                  className="text-destructive hover:bg-destructive/10"
                >
                  <Trash className="h-3.5 w-3.5" weight="bold" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {shares && active.length === 0 && (
          <div className={cn("text-xs text-muted-foreground italic")}>
            尚无有效分享链接。
          </div>
        )}
      </CardContent>
    </Card>
  );
}
