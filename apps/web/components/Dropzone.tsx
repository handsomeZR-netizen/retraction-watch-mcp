"use client";

import clsx from "clsx";
import {
  CloudUpload,
  FileText,
  FileType2,
  Lock,
  Loader2,
} from "lucide-react";
import { useDropzone } from "react-dropzone";

interface DropzoneProps {
  onDrop: (files: File[]) => void;
  busy: boolean;
  hint?: string;
}

export function Dropzone({ onDrop, busy, hint }: DropzoneProps) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "application/x-tex": [".tex"],
      "text/x-tex": [".tex"],
      "application/zip": [".zip"],
    },
    disabled: busy,
  });

  return (
    <div
      {...getRootProps()}
      data-disabled={busy}
      className={clsx("dropzone", isDragActive && "dropzone-active")}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center gap-3">
        <div
          className={clsx(
            "rounded-full p-4 transition-colors",
            busy
              ? "bg-white/5 text-slate-300"
              : isDragActive
                ? "bg-blue-500/20 text-blue-300"
                : "bg-white/5 text-slate-300",
          )}
        >
          {busy ? (
            <Loader2 className="w-7 h-7 animate-spin" />
          ) : (
            <CloudUpload className="w-7 h-7" strokeWidth={1.6} />
          )}
        </div>
        <div className="text-base font-medium">
          {busy ? "正在解析中..." : isDragActive ? "释放即可上传" : "拖拽文件到此处，或点击选择"}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> PDF
          </span>
          <span className="inline-flex items-center gap-1.5">
            <FileType2 className="w-3.5 h-3.5" /> Word
          </span>
          <span className="inline-flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> LaTeX
          </span>
          <span className="text-slate-600">·</span>
          <span>最大 50 MB</span>
        </div>
        {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-1">
          <Lock className="w-3 h-3" /> 默认本地解析，不上传第三方
        </div>
      </div>
    </div>
  );
}
