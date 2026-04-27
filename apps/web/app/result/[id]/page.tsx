import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  Cloud,
  Download,
  ExternalLink,
  Mail,
  Network,
  User,
} from "lucide-react";
import { ReferenceTable } from "@/components/ReferenceTable";
import { VerdictCard } from "@/components/VerdictCard";
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

  return (
    <div className="space-y-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        返回首页
      </Link>

      <section className="surface p-6 space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground mb-1 truncate">
              {result.fileName}
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight leading-tight text-foreground">
              {result.metadata.title ?? (
                <span className="text-muted-foreground">(未识别标题)</span>
              )}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="w-3.5 h-3.5" />
                {new Date(result.generatedAt).toLocaleString()}
              </span>
              <span className="code">{result.policyVersion}</span>
              <span>{result.fileType.toUpperCase()}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/api/report/${id}?format=download`}
              className="btn"
              prefetch={false}
            >
              <Download className="w-4 h-4" />
              JSON
            </Link>
            <Link
              href={`/api/report/${id}?format=csv`}
              className="btn"
              prefetch={false}
            >
              <Download className="w-4 h-4" />
              CSV
            </Link>
          </div>
        </div>

        <VerdictCard verdict={result.verdict} totals={result.totals} />
      </section>

      {result.metadata.authors.length > 0 && (
        <section className="surface p-6">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2 text-foreground">
            <User className="w-4 h-4 text-muted-foreground" />
            稿件作者
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {result.metadata.authors.map((author, i) => {
              const initial =
                author.name?.trim()?.charAt(0).toUpperCase() ?? "?";
              return (
                <div
                  key={i}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-md surface-2"
                >
                  <span className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
                    {initial}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate">
                      {author.name}
                    </div>
                    {author.affiliation && (
                      <div className="text-xs text-muted-foreground truncate">
                        {author.affiliation}
                      </div>
                    )}
                    {(author.email || author.orcid) && (
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                        {author.email && (
                          <a
                            href={`mailto:${author.email}`}
                            className="inline-flex items-center gap-1 hover:text-foreground"
                          >
                            <Mail className="w-3 h-3" />
                            {author.email}
                          </a>
                        )}
                        {author.orcid && (
                          <a
                            href={`https://orcid.org/${author.orcid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 hover:text-foreground"
                          >
                            ORCID {author.orcid}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <ReferenceTable entries={result.screenedReferences} />

      <section className="grid md:grid-cols-2 gap-4">
        <div className="surface p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-foreground">
            <Network className="w-4 h-4 text-muted-foreground" />
            出网调用统计
          </h3>
          <ul className="text-xs text-muted-foreground space-y-1.5">
            <li className="flex justify-between">
              <span>DeepSeek / LLM API</span>
              <span className="code text-foreground">
                {result.network.deepseekCalls}
              </span>
            </li>
            <li className="flex justify-between">
              <span>Crossref reverse lookup</span>
              <span className="code text-foreground">
                {result.network.crossrefCalls}
              </span>
            </li>
            <li className="flex justify-between">
              <span>云 OCR</span>
              <span className="code text-foreground">
                {result.network.cloudOcrCalls}
              </span>
            </li>
          </ul>
        </div>
        <div className="surface p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-foreground">
            <Cloud className="w-4 h-4 text-muted-foreground" />
            数据快照
          </h3>
          <ul className="text-xs text-muted-foreground space-y-1.5">
            <li className="flex justify-between">
              <span>RW 数据日期</span>
              <span className="code text-foreground">
                {result.sourceVersion?.generatedOn ?? "未知"}
              </span>
            </li>
            <li className="flex justify-between">
              <span>记录数</span>
              <span className="code text-foreground">
                {result.sourceVersion?.rowCount?.toLocaleString() ?? "—"}
              </span>
            </li>
            <li className="flex justify-between">
              <span>导入时间</span>
              <span className="code text-foreground">
                {result.sourceVersion?.importedAt
                  ? new Date(result.sourceVersion.importedAt).toLocaleDateString()
                  : "—"}
              </span>
            </li>
          </ul>
        </div>
      </section>

      <section className="surface px-5 py-4 text-xs text-muted-foreground leading-relaxed">
        <span className="text-warning font-medium">⚠ 免责声明：</span>
        {result.consequentialUseWarning}
        {result.warnings.length > 0 && (
          <ul className="list-disc pl-5 mt-2 space-y-0.5">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
