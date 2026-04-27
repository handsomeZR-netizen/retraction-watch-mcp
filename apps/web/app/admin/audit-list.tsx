"use client";

import { useEffect, useState } from "react";
import { ListChecks } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface AuditItem {
  id: number;
  userId: string | null;
  username: string | null;
  action: string;
  detail: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

const ACTION_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive" | "muted"> = {
  login: "success",
  login_failed: "destructive",
  logout: "muted",
  register: "default",
  upload: "secondary",
  delete_manuscript: "warning",
  change_settings: "muted",
};

export function AdminAuditList() {
  const [items, setItems] = useState<AuditItem[] | null>(null);

  useEffect(() => {
    void fetch("/api/admin/audit?limit=200").then(async (res) => {
      if (!res.ok) {
        toast.error("加载审计日志失败");
        return;
      }
      const j = (await res.json()) as { items: AuditItem[] };
      setItems(j.items);
    });
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="h-4 w-4" weight="duotone" />
          审计日志（最近 200 条）
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!items && <Skeleton className="h-32 w-full" />}
        {items && items.length === 0 && (
          <div className="text-sm text-muted-foreground py-6 text-center">
            暂无记录
          </div>
        )}
        {items && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">时间</th>
                  <th className="py-2 pr-3 font-medium">用户</th>
                  <th className="py-2 pr-3 font-medium">操作</th>
                  <th className="py-2 pr-3 font-medium">详情</th>
                  <th className="py-2 pr-3 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-border/50 align-top">
                    <td className="py-2 pr-3 font-mono text-muted-foreground whitespace-nowrap">
                      {new Date(it.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 font-mono">
                      {it.username ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant={ACTION_VARIANT[it.action] ?? "muted"}>
                        {it.action}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 font-mono text-muted-foreground max-w-md truncate">
                      {it.detail ? JSON.stringify(it.detail) : ""}
                    </td>
                    <td className="py-2 pr-3 font-mono text-muted-foreground">
                      {it.ip ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
