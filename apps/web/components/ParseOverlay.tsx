"use client";

import { CheckCircle, CircleNotch, FileText } from "@phosphor-icons/react";

interface Props {
  fileName: string;
  message?: string;
}

export function ParseOverlay({ fileName, message }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 grid place-items-center bg-background/85 backdrop-blur-sm animate-fade-in-up"
    >
      <div className="text-center space-y-5 px-6 max-w-sm">
        <div className="relative grid place-items-center mx-auto h-20 w-20">
          <CircleNotch
            className="h-20 w-20 text-foreground/15 animate-spin"
            weight="bold"
            style={{ animationDuration: "1.6s" }}
          />
          <CheckCircle
            className="absolute h-9 w-9 text-success"
            weight="fill"
          />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-base font-semibold">解析完成，正在生成报告</h3>
          <p className="text-sm text-muted-foreground">
            {message ?? "整理证据并跳转到报告页面…"}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted text-xs text-muted-foreground font-mono max-w-full">
          <FileText className="h-3.5 w-3.5 shrink-0" weight="duotone" />
          <span className="truncate">{fileName}</span>
        </div>
      </div>
    </div>
  );
}
