"use client";

import Link from "next/link";
import {
  ChartBar,
  ClockCounterClockwise,
  Database,
  Gear,
  ShieldCheck,
  User,
  UsersThree,
  type Icon as PIcon,
} from "@phosphor-icons/react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Action {
  href: string;
  icon: PIcon;
  label: string;
  accent?: "warning";
}

export function QuickActions({ role }: { role: "admin" | "user" }) {
  const actions: Action[] = [
    { href: "/history", icon: ClockCounterClockwise, label: "历史记录" },
    { href: "/workspaces", icon: UsersThree, label: "团队空间" },
    { href: "/settings", icon: Gear, label: "解析设置" },
    { href: "/account", icon: User, label: "账户" },
  ];
  if (role === "admin") {
    actions.push(
      { href: "/admin", icon: ShieldCheck, label: "管理后台", accent: "warning" },
      { href: "/admin/analytics", icon: ChartBar, label: "解析分析", accent: "warning" },
      { href: "/admin#import", icon: Database, label: "刷新撤稿库", accent: "warning" },
    );
  }

  return (
    <Card className="overflow-hidden">
      <header className="px-4 py-2.5 border-b border-border">
        <h2 className="text-sm font-semibold">快捷入口</h2>
      </header>
      <div className="divide-y divide-border">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="px-4 py-2.5 flex items-center gap-3 hover:bg-accent/40 transition-colors min-w-0"
          >
            <a.icon
              className={cn(
                "h-4 w-4 shrink-0",
                a.accent === "warning" ? "text-warning" : "text-muted-foreground",
              )}
              weight="duotone"
            />
            <span className="text-sm font-medium truncate">{a.label}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}
