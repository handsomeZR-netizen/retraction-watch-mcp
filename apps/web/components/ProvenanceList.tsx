"use client";

import type { ProvenanceMap, SourceTag } from "@rw/core";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<SourceTag, string> = {
  regex_doi: "DOI 正则",
  regex_pmid: "PMID 正则",
  regex_text: "正文启发",
  bibtex: "BibTeX",
  llm: "LLM",
  crossref: "Crossref",
  europepmc: "Europe PMC",
  openalex: "OpenAlex",
};

const SOURCE_TONE: Record<SourceTag, string> = {
  regex_doi: "bg-primary/10 text-primary border-primary/20",
  regex_pmid: "bg-primary/10 text-primary border-primary/20",
  regex_text: "bg-muted text-muted-foreground border-border",
  bibtex: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/20",
  llm: "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20",
  crossref: "bg-success/10 text-success border-success/20",
  europepmc: "bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-500/20",
  openalex: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
};

const FIELD_LABEL: Record<keyof ProvenanceMap, string> = {
  title: "标题",
  doi: "DOI",
  pmid: "PMID",
  year: "年份",
  authors: "作者",
  journal: "期刊",
};

const FIELD_ORDER: (keyof ProvenanceMap)[] = [
  "title",
  "authors",
  "year",
  "doi",
  "pmid",
  "journal",
];

export function ProvenanceList({ provenance }: { provenance: ProvenanceMap }) {
  const present = FIELD_ORDER.filter((f) => provenance[f] !== undefined);
  if (present.length === 0) return null;

  return (
    <div className="mt-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
        字段来源
      </div>
      <ul className="space-y-1.5">
        {present.map((field) => {
          const entry = provenance[field];
          if (!entry) return null;
          const conflicts = entry.conflicts ?? [];
          return (
            <li key={field} className="flex items-start gap-2 text-xs leading-relaxed">
              <span className="font-medium text-foreground w-12 shrink-0 small-caps">
                {FIELD_LABEL[field]}
              </span>
              <SourceBadge source={entry.source} />
              <ConfidenceBar confidence={entry.confidence} />
              {conflicts.length > 0 && (
                <span className="text-warning small-caps text-[10px] font-medium">
                  · {conflicts.length} 冲突
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {present.some((f) => (provenance[f]?.conflicts?.length ?? 0) > 0) && (
        <ConflictDetails provenance={provenance} present={present} />
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: SourceTag }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono border",
        SOURCE_TONE[source],
      )}
    >
      {SOURCE_LABEL[source]}
    </span>
  );
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.max(0, Math.min(1, confidence));
  const tone =
    pct >= 0.9 ? "bg-success" : pct >= 0.6 ? "bg-primary" : "bg-warning";
  return (
    <span className="inline-flex items-center gap-1.5 flex-1 min-w-0">
      <span className="h-1 flex-1 bg-muted rounded-full overflow-hidden max-w-[120px]">
        <span
          className={cn("block h-full rounded-full", tone)}
          style={{ width: `${pct * 100}%` }}
        />
      </span>
      <span className="font-mono text-[10px] text-muted-foreground tabular-nums w-9 shrink-0">
        {pct.toFixed(2)}
      </span>
    </span>
  );
}

function ConflictDetails({
  provenance,
  present,
}: {
  provenance: ProvenanceMap;
  present: (keyof ProvenanceMap)[];
}) {
  const conflicts = present.flatMap((field) => {
    const entry = provenance[field];
    if (!entry?.conflicts || entry.conflicts.length === 0) return [];
    return entry.conflicts.map((c) => ({ field, conflict: c, local: entry }));
  });
  if (conflicts.length === 0) return null;
  return (
    <div className="mt-2 ml-14 text-[11px] text-muted-foreground border-l-2 border-warning/50 pl-3 space-y-1">
      <div className="small-caps text-warning font-medium text-[10px]">外部源冲突</div>
      {conflicts.map((c, i) => (
        <div key={i}>
          <span className="font-medium">{FIELD_LABEL[c.field]}</span>
          <span className="ml-1.5">
            本地 (<span className="font-mono">{SOURCE_LABEL[c.local.source]}</span>) ≠ {SOURCE_LABEL[c.conflict.source]}
          </span>
          <div className="font-mono text-[10px] mt-0.5 text-foreground/70 truncate">
            ↳ {String(c.conflict.value).slice(0, 120)}
          </div>
        </div>
      ))}
    </div>
  );
}
