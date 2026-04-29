"use client";

import { CloudArrowUp, FilePdf, FileDoc, FileText, Lock } from "@phosphor-icons/react";
import { useDropzone } from "react-dropzone";
import { cn } from "@/lib/utils";

interface DropzoneProps {
  onDrop: (files: File[]) => void;
  busy: boolean;
  hint?: string;
}

export function Dropzone({ onDrop, busy, hint }: DropzoneProps) {
  // Don't pass `disabled: busy` — react-dropzone v14 unmounts every drag /
  // drop listener when disabled is true, so once a parse starts the user can
  // no longer drop another file (the drop event silently has no handler).
  // Use `noClick: busy` instead: keep drag listeners attached at all times,
  // only suppress the file-picker click affordance while parsing is active.
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    maxFiles: 8,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/x-tex": [".tex"],
      "text/x-tex": [".tex"],
      "application/zip": [".zip"],
    },
    noClick: busy,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "group relative rounded-xl border-2 border-dashed border-border bg-card p-10 text-center cursor-pointer transition-all duration-200",
        "hover:border-foreground/30 hover:bg-accent/30",
        isDragActive && "border-foreground bg-accent/50 scale-[1.01]",
        busy && "cursor-not-allowed opacity-70",
      )}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center gap-4">
        <div
          className={cn(
            "grid h-14 w-14 place-items-center rounded-full transition-colors",
            isDragActive
              ? "bg-foreground text-background"
              : "bg-muted text-foreground",
          )}
        >
          <CloudArrowUp
            className={cn("h-7 w-7", busy && "animate-pulse")}
            weight={isDragActive ? "fill" : "duotone"}
          />
        </div>
        <div>
          <div className="text-base font-medium">
            {busy
              ? "正在解析中..."
              : isDragActive
                ? "释放即可上传"
                : "拖拽文件到此处"}
          </div>
          <div className="text-xs text-muted-foreground mt-1">或点击选择文件</div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <FormatChip icon={FilePdf} label="PDF" />
          <Sep />
          <FormatChip icon={FileDoc} label="Word" />
          <Sep />
          <FormatChip icon={FileText} label="LaTeX" />
          <Sep />
          <span>50 MB</span>
        </div>
        {hint && (
          <div className="text-xs text-muted-foreground font-mono">{hint}</div>
        )}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Lock className="h-3 w-3" weight="duotone" />
          默认本地解析，不上传第三方
        </div>
      </div>
    </div>
  );
}

function FormatChip({
  icon: Icon,
  label,
}: {
  icon: typeof FilePdf;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3.5 w-3.5" weight="duotone" />
      {label}
    </span>
  );
}

function Sep() {
  return <span className="h-3 w-px bg-border" aria-hidden />;
}
