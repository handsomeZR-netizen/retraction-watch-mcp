"use client";

import { useEffect, useState } from "react";

interface HealthResponse {
  ok: boolean;
  database?: {
    rowCount: number;
    generatedOn: string | null;
  };
  error?: string;
}

export function StatusDot() {
  const [state, setState] = useState<"loading" | "ok" | "fail">("loading");
  const [info, setInfo] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then(async (res) => {
        const data = (await res.json()) as HealthResponse;
        if (cancelled) return;
        if (data.ok) {
          setState("ok");
          setInfo(
            `数据库 ${data.database?.rowCount.toLocaleString()} 条记录 · 数据日期 ${
              data.database?.generatedOn ?? "未知"
            }`,
          );
        } else {
          setState("fail");
          setInfo(data.error ?? "未知错误");
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
    <div
      className="flex items-center gap-2 text-xs text-muted-foreground"
      title={info}
    >
      <span
        className="status-dot"
        data-status={state === "loading" ? "warn" : state}
      />
      <span>
        {state === "loading"
          ? "检查中"
          : state === "ok"
            ? "数据库就绪"
            : "数据库异常"}
      </span>
    </div>
  );
}
