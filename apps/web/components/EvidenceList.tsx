import clsx from "clsx";
import { Sparkle, Triangle, Minus } from "lucide-react";
import type { MatchEvidence } from "@rw/core";

const STRENGTH_META: Record<
  MatchEvidence["strength"],
  { label: string; color: string; icon: typeof Sparkle }
> = {
  strong: { label: "强", color: "text-emerald-300", icon: Sparkle },
  medium: { label: "中", color: "text-blue-300", icon: Sparkle },
  weak: { label: "弱", color: "text-amber-300", icon: Triangle },
  negative: { label: "扣分", color: "text-rose-300", icon: Minus },
  info: { label: "提示", color: "text-slate-400", icon: Minus },
};

export function EvidenceList({ evidence }: { evidence: MatchEvidence[] }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2">
        证据明细
      </div>
      <ul className="space-y-1.5">
        {evidence.map((ev, i) => {
          const m = STRENGTH_META[ev.strength];
          const Icon = m.icon;
          return (
            <li key={i} className="flex items-start gap-2 text-xs">
              <Icon
                className={clsx("w-3 h-3 mt-0.5 shrink-0", m.color)}
                strokeWidth={2.1}
              />
              <span className="flex-1 text-slate-300 leading-relaxed">
                <span className="font-medium text-slate-200">{ev.field}</span>
                <span className={clsx("ml-1.5", m.color)}>· {m.label}</span>
                <span className="text-slate-500 ml-1.5 code">
                  Δ{ev.scoreDelta > 0 ? "+" : ""}
                  {ev.scoreDelta}
                </span>
                <div className="text-slate-400 mt-0.5">{ev.message}</div>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
