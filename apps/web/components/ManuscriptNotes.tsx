"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, NotePencil } from "@phosphor-icons/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  manuscriptId: string;
  initialNotes: string | null;
  initialUpdatedAt: string | null;
}

const NOTES_LIMIT = 4000;

/**
 * Free-form per-manuscript notes for review workflow. Auto-saves on blur and
 * debounces while typing — small-team UX is "type whatever, switch tabs, it's
 * persisted." Capped at 4000 chars by the server.
 */
export function ManuscriptNotes({
  manuscriptId,
  initialNotes,
  initialUpdatedAt,
}: Props) {
  const [value, setValue] = useState(initialNotes ?? "");
  const [savedAt, setSavedAt] = useState<string | null>(initialUpdatedAt);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastSavedRef = useRef(initialNotes ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = async (next: string) => {
    if (next === lastSavedRef.current) return;
    setStatus("saving");
    try {
      const res = await fetch(`/api/manuscripts/${manuscriptId}/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: next.length === 0 ? null : next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { updatedAt: string };
      lastSavedRef.current = next;
      setSavedAt(j.updatedAt);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1500);
    } catch {
      setStatus("error");
    }
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void persist(value), 1200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const overLimit = value.length > NOTES_LIMIT;

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <NotePencil className="h-4 w-4 text-muted-foreground" weight="duotone" />
          审稿备注
        </CardTitle>
        <span className="text-[11px] text-muted-foreground">
          <StatusLabel status={status} savedAt={savedAt} />
        </span>
      </CardHeader>
      <CardContent>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void persist(value)}
          placeholder="任何复核笔记、待办、和作者的沟通进度… 自动保存。仅本工作区成员可见。"
          rows={4}
          className={cn(
            "w-full resize-y rounded-md border bg-background px-3 py-2 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-ring",
            overLimit
              ? "border-destructive focus:ring-destructive/40"
              : "border-input focus:ring-ring/40",
          )}
        />
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className={cn(overLimit && "text-destructive")}>
            {value.length} / {NOTES_LIMIT}
          </span>
          {savedAt && (
            <span>
              上次保存：
              {new Date(savedAt).toLocaleString()}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusLabel({
  status,
  savedAt,
}: {
  status: "idle" | "saving" | "saved" | "error";
  savedAt: string | null;
}) {
  if (status === "saving") return <span className="text-muted-foreground">保存中…</span>;
  if (status === "saved")
    return (
      <span className="inline-flex items-center gap-1 text-success">
        <CheckCircle className="h-3 w-3" weight="fill" /> 已保存
      </span>
    );
  if (status === "error") return <span className="text-destructive">保存失败</span>;
  if (!savedAt) return <span className="text-muted-foreground">未保存</span>;
  return null;
}
