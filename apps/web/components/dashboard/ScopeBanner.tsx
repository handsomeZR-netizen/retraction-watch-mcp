"use client";

import Link from "next/link";
import {
  Database,
  House,
  Lightning,
  UsersThree,
} from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  user: { displayName: string | null; username: string };
  workspace: { id: string; name: string; memberCount: number } | null;
  llm: { enabled: boolean; model: string };
  source: { rowCount: number; generatedOn: string | null } | null;
}

export function ScopeBanner({ user, workspace, llm, source }: Props) {
  const name =
    user.displayName ?? user.username.split("@")[0] ?? user.username;
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
        <Link href="/settings">
          <Badge
            variant="muted"
            className={cn(
              "cursor-pointer hover:bg-accent transition-colors h-7",
              llm.enabled && "border-success/40",
            )}
          >
            <Lightning
              className={cn("h-3.5 w-3.5", llm.enabled ? "text-success" : "")}
              weight="duotone"
            />
            <span>LLM {llm.enabled ? "已启用" : "未启用"}</span>
            {llm.enabled && (
              <span className="text-muted-foreground ml-1 font-mono">· {llm.model}</span>
            )}
          </Badge>
        </Link>
        {source && (
          <Badge variant="muted" className="h-7">
            <Database className="h-3.5 w-3.5" weight="duotone" />
            <span>RW 库 {source.rowCount.toLocaleString()} 条</span>
            {source.generatedOn && (
              <span className="text-muted-foreground ml-1">· {source.generatedOn}</span>
            )}
          </Badge>
        )}
      </div>
    </div>
  );
}
