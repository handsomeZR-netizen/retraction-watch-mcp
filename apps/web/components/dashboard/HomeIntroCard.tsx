"use client";

import Link from "next/link";
import {
  Cloud,
  MagnifyingGlass,
  ShieldCheck,
  Sparkle,
  ArrowRight,
  type Icon as PIcon,
} from "@phosphor-icons/react";
import { Card } from "@/components/ui/card";

interface Step {
  index: number;
  icon: PIcon;
  title: string;
  hint: string;
}

const STEPS: Step[] = [
  {
    index: 1,
    icon: Cloud,
    title: "拖入或选择文件",
    hint: "支持 PDF / Word / LaTeX，本地优先解析",
  },
  {
    index: 2,
    icon: MagnifyingGlass,
    title: "自动识别引用",
    hint: "正则切分 + LLM 兜底 + Crossref 反查 DOI",
  },
  {
    index: 3,
    icon: ShieldCheck,
    title: "查看撤稿命中",
    hint: "比对 Retraction Watch 7 万 + 记录，给出 PASS / REVIEW / FAIL",
  },
];

export function HomeIntroCard() {
  return (
    <Card className="overflow-hidden">
      <header className="px-4 py-2.5 border-b border-border flex items-center gap-2">
        <Sparkle className="h-4 w-4 text-primary" weight="duotone" />
        <h2 className="text-sm font-semibold">使用入门</h2>
      </header>

      <ol className="divide-y divide-border">
        {STEPS.map((step) => (
          <li
            key={step.index}
            className="px-4 py-3 flex items-start gap-3 min-w-0"
          >
            <span
              className="grid h-7 w-7 place-items-center rounded-full bg-muted text-muted-foreground text-xs font-semibold shrink-0"
              aria-hidden
            >
              {step.index}
            </span>
            <step.icon
              className="h-4 w-4 mt-1 text-muted-foreground shrink-0"
              weight="duotone"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium leading-tight">
                {step.title}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
                {step.hint}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <Link
        href="/settings"
        className="block px-4 py-2.5 border-t border-border bg-muted/30 hover:bg-accent/40 transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-foreground">
              本版本：双栏 PDF 智能切分 + DOI 反查默认开
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              在设置中填联系邮箱即可解锁 Crossref / Europe PMC 反查
            </div>
          </div>
          <ArrowRight
            className="h-3.5 w-3.5 text-muted-foreground shrink-0"
            weight="bold"
          />
        </div>
      </Link>
    </Card>
  );
}
