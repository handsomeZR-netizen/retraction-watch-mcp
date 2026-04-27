"use client";

import { Lightning, Triangle, Minus } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import type { MatchEvidence } from "@rw/core";
import { cn } from "@/lib/utils";

const STRENGTH_META: Record<
  MatchEvidence["strength"],
  { label: string; color: string; icon: Icon }
> = {
  strong: { label: "强", color: "text-success", icon: Lightning },
  medium: { label: "中", color: "text-foreground", icon: Lightning },
  weak: { label: "弱", color: "text-warning", icon: Triangle },
  negative: { label: "扣分", color: "text-destructive", icon: Minus },
  info: { label: "提示", color: "text-muted-foreground", icon: Minus },
};

export function EvidenceList({ evidence }: { evidence: MatchEvidence[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
        证据明细
      </div>
      <ul className="space-y-2">
        {evidence.map((ev, i) => {
          const m = STRENGTH_META[ev.strength];
          const Icon = m.icon;
          return (
            <li
              key={i}
              className="flex items-start gap-2 text-xs leading-relaxed"
            >
              <Icon
                className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", m.color)}
                weight="fill"
              />
              <span className="flex-1">
                <span className="font-medium text-foreground">{ev.field}</span>
                <span className={cn("ml-1.5 font-medium", m.color)}>
                  · {m.label}
                </span>
                <span className="text-muted-foreground ml-1.5 font-mono">
                  Δ{ev.scoreDelta > 0 ? "+" : ""}
                  {ev.scoreDelta}
                </span>
                <div className="text-muted-foreground mt-0.5">{ev.message}</div>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
