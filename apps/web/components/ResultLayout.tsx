"use client";

import { useState } from "react";
import { PdfPreview } from "./PdfPreview";
import { cn } from "@/lib/utils";

interface Props {
  manuscriptId: string;
  fileName: string;
  fileType: string;
  bytes?: number | null;
  children: React.ReactNode;
}

// Only PDFs render usefully in an iframe; for other formats we default to the
// collapsed preview header so the result panel gets full width by default.
function canPreviewInline(fileType: string): boolean {
  return fileType === "pdf";
}

export function ResultLayout({
  manuscriptId,
  fileName,
  fileType,
  bytes,
  children,
}: Props) {
  const [hidden, setHidden] = useState(() => !canPreviewInline(fileType));

  return (
    <div
      className={cn(
        "grid gap-6 items-start",
        hidden ? "grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]",
      )}
    >
      <div className={cn("space-y-3", !hidden && "lg:sticky lg:top-20")}>
        <PdfPreview
          manuscriptId={manuscriptId}
          fileName={fileName}
          fileType={fileType}
          bytes={bytes}
          hidden={hidden}
          onToggleHide={() => setHidden((v) => !v)}
        />
      </div>
      <div className="space-y-6 min-w-0">{children}</div>
    </div>
  );
}
