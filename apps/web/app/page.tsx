"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useRouter } from "next/navigation";

type ParseEvent = {
  stage:
    | "uploaded"
    | "text_extracted"
    | "metadata_extracted"
    | "refs_segmented"
    | "refs_structured"
    | "screening"
    | "done"
    | "error";
  message?: string;
  detail?: Record<string, unknown>;
  manuscriptId?: string;
};

export default function HomePage() {
  const router = useRouter();
  const [events, setEvents] = useState<ParseEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const onDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      setBusy(true);
      setError(null);
      setEvents([{ stage: "uploaded", message: `已接收 ${file.name}` }]);

      try {
        const formData = new FormData();
        formData.append("file", file);
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok) {
          throw new Error(await uploadRes.text());
        }
        const { manuscriptId } = (await uploadRes.json()) as { manuscriptId: string };

        const sse = new EventSource(`/api/parse?manuscriptId=${encodeURIComponent(manuscriptId)}`);
        eventSourceRef.current = sse;
        sse.onmessage = (ev) => {
          if (!ev.data) return;
          try {
            const payload = JSON.parse(ev.data) as ParseEvent;
            setEvents((prev) => [...prev, payload]);
            if (payload.stage === "done") {
              sse.close();
              eventSourceRef.current = null;
              router.push(`/result/${encodeURIComponent(manuscriptId)}`);
            }
            if (payload.stage === "error") {
              sse.close();
              eventSourceRef.current = null;
              setBusy(false);
              setError(payload.message ?? "解析失败");
            }
          } catch {
            // ignore non-JSON lines
          }
        };
        sse.onerror = () => {
          sse.close();
          eventSourceRef.current = null;
          setBusy(false);
          setError("SSE 连接断开");
        };
      } catch (e) {
        setBusy(false);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [router],
  );

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
    <div className="space-y-8">
      <section className="surface p-8">
        <h1 className="text-2xl font-bold mb-2">学术稿件诚信筛查</h1>
        <p className="text-slate-300 text-sm leading-relaxed">
          拖拽 PDF / Word(.docx) / LaTeX(.tex / .zip) 文件到下方区域，自动抽取作者信息和参考文献，
          并比对本地 Retraction Watch 数据库。引用了已撤稿文献会标记为不通过。
          所有解析默认在本地完成，启用 LLM/云 OCR 才会发起出网请求。
        </p>
      </section>

      <section
        {...getRootProps()}
        className={`dropzone ${isDragActive ? "dropzone-active" : ""}`}
      >
        <input {...getInputProps()} />
        <div className="text-base">
          {busy
            ? "正在解析中..."
            : isDragActive
              ? "释放即可上传"
              : "拖拽文件到此处，或点击选择文件"}
        </div>
        <div className="text-xs text-slate-400 mt-2">
          支持 PDF、Word(.docx)、LaTeX(.tex/.zip)。最大 50 MB。
        </div>
      </section>

      {error && (
        <div className="surface p-4 border border-red-500/30 bg-red-500/10 text-red-200">
          {error}
        </div>
      )}

      {events.length > 0 && (
        <section className="surface p-6">
          <h2 className="text-base font-semibold mb-3">解析进度</h2>
          <ul className="space-y-2 text-sm">
            {events.map((ev, idx) => (
              <li key={idx} className="flex gap-3">
                <span className="text-slate-500 w-32 shrink-0">{ev.stage}</span>
                <span className="text-slate-200">{ev.message ?? ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="surface p-6 text-sm text-slate-300 leading-relaxed">
        <h3 className="font-semibold mb-2">检测内容</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>抽取稿件作者、机构、邮箱、ORCID（如有）。</li>
          <li>抽取参考文献条目，按 DOI 直接比对，无 DOI 时按标题+作者+年份近似比对。</li>
          <li>命中 Retraction Watch 撤稿、撤稿声明、关注表达 (Expression of concern) 的文献，标记 FAIL。</li>
          <li>无 DOI 但标题+作者高度相似的，标记 REVIEW（人工复核）。</li>
        </ul>
      </section>
    </div>
  );
}
