import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CalendarBlank,
  CloudArrowDown,
  ArrowSquareOut,
  Envelope,
  Globe,
  ChartBar,
  UsersThree,
  DownloadSimple,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ReferenceTable } from "@/components/ReferenceTable";
import { ResultLayout } from "@/components/ResultLayout";
import { VerdictCard } from "@/components/VerdictCard";
import { Separator } from "@/components/ui/separator";
import { getManuscript } from "@/lib/db/manuscripts";
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
  const manuscript = getManuscript(id);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3">
        <Link href="/">
          <ArrowLeft className="h-4 w-4" weight="bold" />
          返回首页
        </Link>
      </Button>

      <ResultLayout
        manuscriptId={id}
        fileName={result.fileName}
        fileType={result.fileType}
        bytes={manuscript?.bytes ?? null}
      >
      <Card className="p-6 space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground mb-1 truncate font-mono">
              {result.fileName}
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight leading-tight">
              {result.metadata.title ?? (
                <span className="text-muted-foreground">(未识别标题)</span>
              )}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalendarBlank className="h-3.5 w-3.5" weight="duotone" />
                {new Date(result.generatedAt).toLocaleString()}
              </span>
              <span className="font-mono">{result.policyVersion}</span>
              <span className="font-mono uppercase">{result.fileType}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/report/${id}?format=download`}>
                <DownloadSimple className="h-4 w-4" weight="bold" />
                JSON
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/report/${id}?format=csv`}>
                <DownloadSimple className="h-4 w-4" weight="bold" />
                CSV
              </a>
            </Button>
          </div>
        </div>

        <Separator />

        <VerdictCard verdict={result.verdict} totals={result.totals} />
      </Card>

      {result.metadata.authors.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersThree className="h-4 w-4 text-muted-foreground" weight="duotone" />
              稿件作者
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-3">
              {result.metadata.authors.map((author, i) => {
                const initial =
                  author.name?.trim()?.charAt(0).toUpperCase() ?? "?";
                return (
                  <div
                    key={i}
                    className="flex items-start gap-3 px-3 py-2.5 rounded-md border border-border/60 bg-card"
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-muted text-foreground text-sm font-semibold shrink-0">
                      {initial}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
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
                              <Envelope className="h-3 w-3" weight="duotone" />
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
                              <ArrowSquareOut className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <ReferenceTable entries={result.screenedReferences} />

      <section className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Globe className="h-4 w-4 text-muted-foreground" weight="duotone" />
              出网调用统计
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-xs space-y-1.5">
              <Stat label="DeepSeek / LLM API" value={result.network.deepseekCalls} />
              <Stat label="Crossref reverse lookup" value={result.network.crossrefCalls} />
              <Stat label="云 OCR" value={result.network.cloudOcrCalls} />
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ChartBar className="h-4 w-4 text-muted-foreground" weight="duotone" />
              数据快照
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-xs space-y-1.5">
              <Stat
                label="RW 数据日期"
                value={result.sourceVersion?.generatedOn ?? "未知"}
              />
              <Stat
                label="记录数"
                value={
                  result.sourceVersion?.rowCount?.toLocaleString() ?? "—"
                }
              />
              <Stat
                label="导入时间"
                value={
                  result.sourceVersion?.importedAt
                    ? new Date(
                        result.sourceVersion.importedAt,
                      ).toLocaleDateString()
                    : "—"
                }
              />
            </ul>
          </CardContent>
        </Card>
      </section>

      <Card className="p-5 text-xs text-muted-foreground leading-relaxed">
        <div className="flex items-start gap-2">
          <CloudArrowDown
            className="h-4 w-4 text-warning mt-0.5 shrink-0"
            weight="fill"
          />
          <div>
            <span className="text-foreground font-medium">免责声明：</span>{" "}
            {result.consequentialUseWarning}
            {result.warnings.length > 0 && (
              <ul className="list-disc pl-5 mt-2 space-y-0.5">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>
      </ResultLayout>
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <li className="flex justify-between items-center gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium text-foreground">{value}</span>
    </li>
  );
}
