import { cn } from "@/lib/utils";
import { Sparkle, Triangle, Minus } from "lucide-react";
import type { MatchEvidence } from "@rw/core";

const STRENGTH_META: Record<
  MatchEvidence["strength"],
  { label: string; color: string; icon: typeof Sparkle }
> = {
  strong: { label: "强", color: "text-success", icon: Sparkle },
  medium: { label: "中", color: "text-primary", icon: Sparkle },
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
      <ul className="space-y-1.5">
        {evidence.map((ev, i) => {
          const m = STRENGTH_META[ev.strength];
          const Icon = m.icon;
          return (
            <li key={i} className="flex items-start gap-2 text-xs">
              <Icon
                className={cn("w-3 h-3 mt-0.5 shrink-0", m.color)}
                strokeWidth={2.1}
              />
              <span className="flex-1 text-foreground/90 leading-relaxed">
                <span className="font-medium text-foreground">{ev.field}</span>
                <span className={cn("ml-1.5", m.color)}>· {m.label}</span>
                <span className="text-muted-foreground ml-1.5 code">
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
