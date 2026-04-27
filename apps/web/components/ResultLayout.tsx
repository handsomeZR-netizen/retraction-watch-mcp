"use client";

import { useState } from "react";
import { CornersOut } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { PdfPreview } from "./PdfPreview";
import { cn } from "@/lib/utils";

interface Props {
  manuscriptId: string;
  fileName: string;
  fileType: string;
  bytes?: number | null;
  children: React.ReactNode;
}

export function ResultLayout({
  manuscriptId,
  fileName,
  fileType,
  bytes,
  children,
}: Props) {
  const [hidden, setHidden] = useState(false);

  return (
    <div
      className={cn(
        "grid gap-6 items-start",
        hidden ? "grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]",
      )}
    >
      <div className={cn("lg:sticky lg:top-20 space-y-3", hidden && "lg:static")}>
        {hidden ? (
          <div className="flex items-center justify-end">
            <Button variant="outline" size="sm" onClick={() => setHidden(false)}>
              <CornersOut className="h-3.5 w-3.5" weight="bold" />
              展开原文预览
            </Button>
          </div>
        ) : (
          <PdfPreview
            manuscriptId={manuscriptId}
            fileName={fileName}
            fileType={fileType}
            bytes={bytes}
            hidden={false}
            onToggleHide={() => setHidden(true)}
          />
        )}
      </div>
      <div className="space-y-6 min-w-0">{children}</div>
    </div>
  );
}
