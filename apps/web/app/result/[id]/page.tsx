import Link from "next/link";
import { notFound } from "next/navigation";
import { getResult } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function ResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getResult(id);
  if (!result) notFound();

  const verdictBadge = result.verdict === "PASS" ? "badge-pass" : result.verdict === "FAIL" ? "badge-fail" : "badge-review";

  return (
    <div className="space-y-6">
      <section className="surface p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="text-sm text-slate-400">{result.fileName}</div>
            <h1 className="text-2xl font-bold mt-1">
              {result.metadata.title ?? "(未识别标题)"}
            </h1>
            <div className="text-xs text-slate-500 mt-1">
              {new Date(result.generatedAt).toLocaleString()} · {result.policyVersion}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`badge ${verdictBadge}`}>{result.verdict}</span>
            <Link href={`/api/report/${id}?format=download`} className="btn">
              下载 JSON
            </Link>
            <Link href={`/api/report/${id}?format=csv`} className="btn">
              下载 CSV
            </Link>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mt-6 text-sm">
          <div>
            <div className="label">作者</div>
            {result.metadata.authors.length === 0 && (
              <div className="text-slate-400">未识别</div>
            )}
            <ul className="space-y-1">
              {result.metadata.authors.map((a, i) => (
                <li key={i}>
                  <span className="font-medium">{a.name}</span>
                  {a.affiliation && (
                    <span className="text-slate-400"> — {a.affiliation}</span>
                  )}
                  {a.email && (
                    <span className="text-slate-500"> · {a.email}</span>
                  )}
                  {a.orcid && (
                    <span className="text-slate-500"> · ORCID {a.orcid}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="label">概览</div>
            <ul className="space-y-1">
              <li>参考文献：{result.totals.references}</li>
              <li>命中（confirmed）：<span className="text-red-300">{result.totals.confirmed}</span></li>
              <li>可能命中（likely）：<span className="text-yellow-300">{result.totals.likely}</span></li>
              <li>低置信（possible）：<span className="text-yellow-200">{result.totals.possible}</span></li>
              <li>清洁：<span className="text-green-300">{result.totals.clean}</span></li>
            </ul>
            <div className="mt-3 text-xs text-slate-400">
              出网调用：DeepSeek {result.network.deepseekCalls} · Crossref {result.network.crossrefCalls} · 云 OCR {result.network.cloudOcrCalls}
            </div>
          </div>
        </div>
      </section>

      <section className="surface">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-base font-semibold">参考文献比对</h2>
          <span className="text-xs text-slate-400">
            点击单条可查看证据
          </span>
        </div>
        <div className="divide-y divide-white/10">
          {result.screenedReferences.length === 0 && (
            <div className="px-6 py-6 text-sm text-slate-400">
              未抽取到任何参考文献。可能 References 段落定位失败，或 PDF 是扫描版。
            </div>
          )}
          {result.screenedReferences.map((entry, i) => (
            <ReferenceRow key={i} index={i + 1} entry={entry} />
          ))}
        </div>
      </section>

      <section className="surface p-6 text-sm text-slate-300">
        <h3 className="font-semibold mb-2">免责声明</h3>
        <p>{result.consequentialUseWarning}</p>
        {result.warnings.length > 0 && (
          <>
            <h4 className="mt-3 font-semibold">解析告警</h4>
            <ul className="list-disc pl-5 mt-1 text-xs text-slate-400 space-y-1">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function ReferenceRow({
  index,
  entry,
}: {
  index: number;
  entry: NonNullable<Awaited<ReturnType<typeof getResult>>>["screenedReferences"][number];
}) {
  const verdict = entry.result.verdict;
  const badge =
    verdict === "confirmed"
      ? "badge-fail"
      : verdict === "likely_match"
        ? "badge-review"
        : verdict === "possible_match"
          ? "badge-review"
          : "badge-pass";
  return (
    <details className="px-6 py-4 group">
      <summary className="flex items-start gap-4 cursor-pointer list-none">
        <span className="text-xs text-slate-500 w-6 shrink-0 mt-0.5">{index}</span>
        <span className={`badge ${badge} shrink-0`}>{verdict.replace("_match", "")}</span>
        <span className="flex-1 text-sm">
          <span className="font-medium">{entry.reference.title ?? entry.reference.raw.slice(0, 200)}</span>
          {entry.reference.authors.length > 0 && (
            <span className="text-slate-400">
              {" "}— {entry.reference.authors.slice(0, 3).join(", ")}
              {entry.reference.authors.length > 3 ? " et al." : ""}
            </span>
          )}
          {entry.reference.year && (
            <span className="text-slate-500"> ({entry.reference.year})</span>
          )}
          {entry.reference.doi && (
            <span className="text-slate-500 code"> · {entry.reference.doi}</span>
          )}
        </span>
      </summary>
      <div className="mt-3 pl-12 text-sm space-y-2">
        <div className="text-slate-400">
          <span className="text-slate-500">原文：</span>{entry.reference.raw}
        </div>
        {entry.result.bestCandidate && (
          <div className="surface p-3">
            <div className="text-xs text-slate-400">
              匹配到 RW 记录 <span className="code">{entry.result.bestCandidate.record.recordId}</span>
              · score {entry.result.bestCandidate.score.toFixed(2)}
            </div>
            <div className="font-medium mt-1">{entry.result.bestCandidate.record.title}</div>
            <div className="text-xs text-slate-400">
              {entry.result.bestCandidate.record.author} ·{" "}
              {entry.result.bestCandidate.record.journal} ·{" "}
              {entry.result.bestCandidate.record.retractionNature} ·{" "}
              {entry.result.bestCandidate.record.retractionDate}
            </div>
            {entry.result.bestCandidate.record.reason && (
              <div className="text-xs text-amber-300 mt-1">原因：{entry.result.bestCandidate.record.reason}</div>
            )}
          </div>
        )}
        {entry.result.evidence.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-slate-400 space-y-1">
            {entry.result.evidence.map((ev, i) => (
              <li key={i}>
                <span className="font-medium text-slate-300">{ev.field}</span>
                {" "}({ev.strength}, Δ{ev.scoreDelta}) — {ev.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
