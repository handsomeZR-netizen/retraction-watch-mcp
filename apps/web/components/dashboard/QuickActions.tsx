"use client";

import Link from "next/link";
import {
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
  desc: string;
  accent?: "warning";
}

export function QuickActions({ role }: { role: "admin" | "user" }) {
  const actions: Action[] = [
    {
      href: "/history",
      icon: ClockCounterClockwise,
      label: "历史记录",
      desc: "查看所有已解析稿件",
    },
    {
      href: "/workspaces",
      icon: UsersThree,
      label: "团队空间",
      desc: "邀请成员、共享稿件",
    },
    {
      href: "/settings",
      icon: Gear,
      label: "解析设置",
      desc: "LLM、OCR、保留策略",
    },
    {
      href: "/account",
      icon: User,
      label: "账户",
      desc: "邮箱、密码、头像",
    },
  ];
  if (role === "admin") {
    actions.push({
      href: "/admin",
      icon: ShieldCheck,
      label: "管理后台",
      desc: "用户与审计日志",
      accent: "warning",
    });
    actions.push({
      href: "/admin#import",
      icon: Database,
      label: "刷新撤稿库",
      desc: "导入最新 RW 数据",
      accent: "warning",
    });
  }

  return (
    <Card className="overflow-hidden">
      <header className="px-4 py-2.5 border-b border-border">
        <h2 className="text-sm font-semibold">快捷入口</h2>
      </header>
      <div className="grid grid-cols-2 gap-px bg-border">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="bg-card hover:bg-accent/40 transition-colors p-3.5 flex items-start gap-2.5"
          >
            <span
              className={cn(
                "grid h-8 w-8 place-items-center rounded-md shrink-0",
                a.accent === "warning" ? "bg-warning/10 text-warning" : "bg-muted",
              )}
            >
              <a.icon className="h-4 w-4" weight="duotone" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{a.label}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {a.desc}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </Card>
  );
}
