import clsx from "clsx";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

export type Verdict = "PASS" | "REVIEW" | "FAIL";

const META: Record<
  Verdict,
  {
    label: string;
    sub: string;
    badgeClass: string;
    icon: typeof CheckCircle2;
    iconBg: string;
  }
> = {
  PASS: {
    label: "通过",
    sub: "未发现引用了撤稿数据库中的文献",
    badgeClass: "badge-pass",
    icon: CheckCircle2,
    iconBg: "bg-emerald-500/10 text-emerald-400 ring-emerald-400/30",
  },
  REVIEW: {
    label: "待复核",
    sub: "存在弱匹配；建议人工复核",
    badgeClass: "badge-review",
    icon: AlertTriangle,
    iconBg: "bg-amber-500/10 text-amber-400 ring-amber-400/30",
  },
  FAIL: {
    label: "不通过",
    sub: "至少 1 条参考文献已确认为撤稿文献",
    badgeClass: "badge-fail",
    icon: XCircle,
    iconBg: "bg-rose-500/10 text-rose-400 ring-rose-400/30",
  },
};

export function VerdictCard({
  verdict,
  totals,
}: {
  verdict: Verdict;
  totals: {
    references: number;
    confirmed: number;
    likely: number;
    possible: number;
    clean: number;
  };
}) {
  const m = META[verdict];
  const Icon = m.icon;
  return (
    <div className="grid lg:grid-cols-[auto_1fr] gap-6 items-stretch">
      <div className="flex flex-col items-center justify-center px-6 py-5 rounded-xl bg-white/[0.02] border border-white/10 min-w-[200px]">
        <div
          className={clsx(
            "w-14 h-14 rounded-full flex items-center justify-center ring-2",
            m.iconBg,
          )}
        >
          <Icon className="w-7 h-7" strokeWidth={2.1} />
        </div>
        <span className={clsx("badge badge-lg mt-3", m.badgeClass)}>
          {verdict}
        </span>
        <div className="text-base font-medium text-slate-100 mt-3">
          {m.label}
        </div>
        <div className="text-xs text-slate-400 mt-1 text-center max-w-[180px]">
          {m.sub}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="参考文献" value={totals.references} accent="info" />
        <Tile
          label="确认命中"
          value={totals.confirmed}
          accent={totals.confirmed > 0 ? "fail" : "muted"}
        />
        <Tile
          label="疑似"
          value={totals.likely + totals.possible}
          accent={totals.likely + totals.possible > 0 ? "review" : "muted"}
        />
        <Tile label="清洁" value={totals.clean} accent="pass" />
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "pass" | "review" | "fail" | "info" | "muted";
}) {
  const colorClass = {
    pass: "text-emerald-300",
    review: "text-amber-300",
    fail: "text-rose-300",
    info: "text-blue-300",
    muted: "text-slate-400",
  }[accent];
  return (
    <div className="px-4 py-4 rounded-xl bg-white/[0.02] border border-white/10">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
        {label}
      </div>
      <div className={clsx("text-2xl font-semibold mt-1 tabular-nums", colorClass)}>
        {value}
      </div>
    </div>
  );
}
