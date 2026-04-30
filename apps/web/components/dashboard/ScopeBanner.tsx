"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Database,
  GlobeHemisphereWest,
  House,
  Lightning,
  UsersThree,
  Warning,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type LlmSource = "user" | "env" | "config" | "default";

interface Props {
  user: { displayName: string | null; username: string };
  workspace: { id: string; name: string; memberCount: number } | null;
  llm: {
    enabled: boolean;
    model: string;
    source: LlmSource;
    hasApiKey: boolean;
  };
  enrichment?: {
    enabled: boolean;
    hasContactEmail: boolean;
  };
  source: { rowCount: number; generatedOn: string | null } | null;
  onLlmChanged?: () => void | Promise<void>;
}

const SOURCE_LABEL: Record<LlmSource, string> = {
  user: "你的个人配置",
  env: "环境变量自动启用",
  config: "系统级配置",
  default: "未配置",
};

export function ScopeBanner({
  user,
  workspace,
  llm,
  enrichment,
  source,
  onLlmChanged,
}: Props) {
  const name =
    user.displayName ?? user.username.split("@")[0] ?? user.username;
  const [busy, setBusy] = useState(false);

  async function toggleLlm(next: boolean) {
    if (busy) return;
    if (next && !llm.hasApiKey) {
      toast.error("没有可用的 API Key，先去 /settings 配置");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/account/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        toast.error(`切换失败：${res.status}`);
        return;
      }
      toast.success(next ? "LLM 已启用" : "LLM 已关闭");
      await onLlmChanged?.();
    } catch (err) {
      toast.error(`切换失败：${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <h1 className="text-3xl md:text-4xl font-semibold tracking-tight leading-[1.1]">
        你好，{name}
      </h1>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={workspace ? `/workspaces/${workspace.id}` : "/workspaces"}>
          <Badge
            variant={workspace ? "secondary" : "muted"}
            className="cursor-pointer hover:bg-accent transition-colors h-7"
          >
            {workspace ? (
              <UsersThree className="h-3.5 w-3.5" weight="duotone" />
            ) : (
              <House className="h-3.5 w-3.5" weight="duotone" />
            )}
            <span>{workspace ? workspace.name : "个人空间"}</span>
            {workspace && (
              <span className="text-muted-foreground ml-1">· {workspace.memberCount} 人</span>
            )}
          </Badge>
        </Link>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="LLM 状态与开关"
              className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              <Badge
                variant="muted"
                className={cn(
                  "cursor-pointer hover:bg-accent transition-colors h-7",
                  llm.enabled && "border-success/40",
                  llm.source === "env" && "border-warning/50 bg-warning/5",
                )}
              >
                <Lightning
                  className={cn(
                    "h-3.5 w-3.5",
                    llm.enabled ? "text-success" : "",
                    llm.source === "env" && "text-warning",
                  )}
                  weight="duotone"
                />
                <span>LLM {llm.enabled ? "已启用" : "未启用"}</span>
                {llm.enabled && llm.model && (
                  <span className="text-muted-foreground ml-1 font-mono text-[11px]">· {llm.model}</span>
                )}
              </Badge>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 space-y-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">
                LLM 辅助 {llm.enabled ? "已启用" : "未启用"}
              </div>
              <div className="text-xs text-muted-foreground">
                来源：{SOURCE_LABEL[llm.source]}
                {llm.enabled && llm.model && (
                  <>
                    {" "}· 模型 <span className="font-mono">{llm.model}</span>
                  </>
                )}
              </div>
            </div>

            {llm.source === "env" && (
              <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/5 p-2 text-xs">
                <Warning
                  className="h-4 w-4 text-warning shrink-0 mt-0.5"
                  weight="duotone"
                />
                <span>
                  检测到 <span className="font-mono">RW_LLM_API_KEY</span>{" "}
                  环境变量，LLM 被自动启用。如需关闭，**直接关下面这个开关**——会写入你的个人覆盖。
                </span>
              </div>
            )}

            {!llm.hasApiKey && (
              <div className="rounded-md border bg-muted/50 p-2 text-xs text-muted-foreground">
                还没有可用的 API Key。先去
                <Link href="/settings" className="text-primary mx-1 underline">
                  设置页
                </Link>
                填一个再启用。
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">
                {llm.enabled ? "调用第三方 LLM 解析参考文献" : "仅本地正则解析"}
              </div>
              <Switch
                checked={llm.enabled}
                disabled={busy || (!llm.enabled && !llm.hasApiKey)}
                onCheckedChange={(v) => void toggleLlm(v)}
                aria-label="切换 LLM 辅助"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-muted-foreground">
                变更只影响你的账户
              </span>
              <Link href="/settings">
                <Button variant="ghost" size="sm" className="h-7 text-xs">
                  详细设置 →
                </Button>
              </Link>
            </div>
          </PopoverContent>
        </Popover>

        {source && (
          <Badge variant="muted" className="h-7">
            <Database className="h-3.5 w-3.5" weight="duotone" />
            <span>RW 库 {source.rowCount.toLocaleString()} 条</span>
            {source.generatedOn && (
              <span className="text-muted-foreground ml-1">· {source.generatedOn}</span>
            )}
          </Badge>
        )}

        {enrichment?.enabled && !enrichment.hasContactEmail && (
          <Link href="/settings">
            <Badge
              variant="muted"
              className="h-7 cursor-pointer hover:bg-accent transition-colors border-warning/40 bg-warning/5"
              title="Crossref / Europe PMC 反查 DOI 已启用，但未填联系邮箱 — 反查会被跳过。点击去配置"
            >
              <GlobeHemisphereWest
                className="h-3.5 w-3.5 text-warning"
                weight="duotone"
              />
              <span>DOI 反查未启用</span>
              <span className="text-muted-foreground ml-1">· 缺联系邮箱</span>
            </Badge>
          </Link>
        )}
      </div>
    </div>
  );
}
