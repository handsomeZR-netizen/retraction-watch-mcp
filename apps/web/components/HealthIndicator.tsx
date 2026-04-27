"use client";

import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface HealthResponse {
  ok: boolean;
  database?: { rowCount: number; generatedOn: string | null };
  error?: string;
}

export function HealthIndicator() {
  const [state, setState] = useState<"loading" | "ok" | "fail">("loading");
  const [info, setInfo] = useState<string>("正在检查...");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then(async (res) => {
        const data = (await res.json()) as HealthResponse;
        if (cancelled) return;
        if (data.ok) {
          setState("ok");
          setInfo(
            `数据库就绪 · ${data.database?.rowCount.toLocaleString()} 条记录 · 数据日期 ${
              data.database?.generatedOn ?? "未知"
            }`,
          );
        } else {
          setState("fail");
          setInfo(data.error ?? "数据库异常");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setState("fail");
        setInfo(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-muted-foreground px-2 cursor-help">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                state === "ok" && "bg-success",
                state === "fail" && "bg-destructive",
                state === "loading" && "bg-warning animate-pulse",
              )}
            />
            {state === "loading"
              ? "检查中"
              : state === "ok"
                ? "就绪"
                : "异常"}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{info}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
