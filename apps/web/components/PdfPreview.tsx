"use client";

import { useEffect, useState } from "react";
import {
  ArrowSquareOut,
  CircleNotch,
  CornersIn,
  CornersOut,
  DownloadSimple,
  EyeSlash,
  FileDoc,
  FilePdf,
  FileText,
  FileZip,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  manuscriptId: string;
  fileName: string;
  fileType: string;
  bytes?: number | null;
  onToggleHide?: () => void;
  hidden?: boolean;
  className?: string;
}

export function PdfPreview({
  manuscriptId,
  fileName,
  fileType,
  bytes,
  onToggleHide,
  hidden,
  className,
}: Props) {
  const [zoom, setZoom] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const fileUrl = `/api/result/${manuscriptId}/file`;
  const isPdf = fileType === "pdf";

  // Reset the loading state whenever the previewed file changes — without
  // this, switching between manuscripts on the same page would briefly show a
  // stale "loaded" iframe before the new PDF starts streaming.
  useEffect(() => {
    setIframeLoaded(false);
  }, [fileUrl]);

  if (hidden) {
    return (
      <Card className={cn("p-3 flex items-center justify-between gap-2", className)}>
        <span className="text-xs text-muted-foreground truncate font-mono">
          {fileName}
        </span>
        <Button variant="outline" size="sm" onClick={onToggleHide}>
          <CornersOut className="h-3.5 w-3.5" weight="bold" />
          展开预览
        </Button>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "overflow-hidden flex flex-col",
        zoom ? "fixed inset-4 z-50 shadow-2xl" : "h-[calc(100vh-9rem)]",
        className,
      )}
    >
      <header className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-2 bg-card">
        <div className="flex items-center gap-2 min-w-0">
          <FileTypeIcon type={fileType} />
          <span className="text-sm font-medium truncate" title={fileName}>
            {fileName}
          </span>
          {bytes != null && (
            <span className="text-[11px] text-muted-foreground font-mono shrink-0">
              {formatBytes(bytes)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setZoom((v) => !v)}
            title={zoom ? "退出全屏" : "全屏"}
          >
            {zoom ? (
              <CornersIn className="h-3.5 w-3.5" weight="bold" />
            ) : (
              <CornersOut className="h-3.5 w-3.5" weight="bold" />
            )}
          </Button>
          <Button variant="ghost" size="sm" asChild title="新窗口打开">
            <a href={fileUrl} target="_blank" rel="noopener noreferrer">
              <ArrowSquareOut className="h-3.5 w-3.5" weight="bold" />
            </a>
          </Button>
          <Button variant="ghost" size="sm" asChild title="下载原文">
            <a href={fileUrl} download={fileName}>
              <DownloadSimple className="h-3.5 w-3.5" weight="bold" />
            </a>
          </Button>
          {onToggleHide && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleHide}
              title="隐藏预览"
            >
              <EyeSlash className="h-3.5 w-3.5" weight="bold" />
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 bg-muted/30 relative">
        {isPdf ? (
          <>
            <iframe
              src={`${fileUrl}#toolbar=1&navpanes=0&view=FitH`}
              title={fileName}
              className="w-full h-full border-0"
              onLoad={() => setIframeLoaded(true)}
            />
            {!iframeLoaded && <PdfLoadingOverlay bytes={bytes} />}
          </>
        ) : (
          <NonPdfFallback fileType={fileType} fileUrl={fileUrl} fileName={fileName} />
        )}
      </div>
    </Card>
  );
}

function PdfLoadingOverlay({ bytes }: { bytes?: number | null }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-muted/30 backdrop-blur-[1px] pointer-events-none">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <CircleNotch className="h-6 w-6 animate-spin" weight="bold" />
        <div className="text-xs font-mono">
          加载预览中{bytes != null ? ` · ${formatBytes(bytes)}` : ""}
        </div>
      </div>
    </div>
  );
}

function NonPdfFallback({
  fileType,
  fileUrl,
  fileName,
}: {
  fileType: string;
  fileUrl: string;
  fileName: string;
}) {
  const desc =
    fileType === "docx"
      ? "Word 文档暂不支持在线预览，请下载查看。"
      : fileType === "tex"
        ? "LaTeX 源码可在新标签页中以纯文本查看。"
        : fileType === "zip"
          ? "压缩包内含 LaTeX 源码与 .bib，可下载本地解包。"
          : "该格式暂不支持在线预览。";
  return (
    <div className="h-full grid place-items-center px-8 py-12 text-center">
      <div className="space-y-4 max-w-sm">
        <div className="grid place-items-center mx-auto w-14 h-14 rounded-xl bg-muted">
          <FileTypeIcon type={fileType} large />
        </div>
        <div>
          <div className="text-sm font-medium truncate">{fileName}</div>
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            {desc}
          </p>
        </div>
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={fileUrl} target="_blank" rel="noopener noreferrer">
              <ArrowSquareOut className="h-3.5 w-3.5" weight="bold" />
              新窗口打开
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={fileUrl} download={fileName}>
              <DownloadSimple className="h-3.5 w-3.5" weight="bold" />
              下载
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

function FileTypeIcon({ type, large }: { type: string; large?: boolean }) {
  const cls = large ? "h-7 w-7" : "h-4 w-4";
  if (type === "pdf") return <FilePdf className={cn(cls, "text-destructive")} weight="duotone" />;
  if (type === "docx") return <FileDoc className={cn(cls, "text-primary")} weight="duotone" />;
  if (type === "zip") return <FileZip className={cls} weight="duotone" />;
  return <FileText className={cls} weight="duotone" />;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
