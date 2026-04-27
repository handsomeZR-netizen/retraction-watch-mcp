"use client";

import { useEffect, useState } from "react";

interface PublicConfig {
  llm: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
    enableHeaderParse: boolean;
  };
  ocr: { cloudEnabled: boolean };
  retention: { keepUploads: boolean; keepHours: number };
}

export default function SettingsPage() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/settings").then(async (res) => {
      const c = (await res.json()) as PublicConfig;
      setConfig(c);
    });
  }, []);

  if (!config) {
    return <div className="text-slate-400">Loading...</div>;
  }

  async function save(partial: Partial<PublicConfig>) {
    setStatus(null);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
    if (!res.ok) {
      setStatus("保存失败：" + (await res.text()));
      return;
    }
    const next = (await res.json()) as PublicConfig;
    setConfig(next);
    setStatus("已保存");
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">设置</h1>
      <p className="text-sm text-slate-400">
        所有解析默认在本地完成；只有打开下面的开关才会发起出网请求。API Key 仅保存在服务端配置文件，不会进入 git。
      </p>

      <section className="surface p-6 space-y-4">
        <h2 className="font-semibold">LLM 增强（DeepSeek 等 OpenAI 兼容服务）</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.llm.enabled}
            onChange={(e) => void save({ llm: { ...config.llm, enabled: e.target.checked } })}
          />
          启用 LLM 参考文献增强解析
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.llm.enableHeaderParse}
            disabled={!config.llm.enabled}
            onChange={(e) =>
              void save({ llm: { ...config.llm, enableHeaderParse: e.target.checked } })
            }
          />
          启用 LLM 首页元数据增强（更耗 token）
        </label>

        <div>
          <label className="label">Base URL</label>
          <input
            className="input"
            value={config.llm.baseUrl}
            onChange={(e) => setConfig({ ...config, llm: { ...config.llm, baseUrl: e.target.value } })}
            onBlur={(e) => void save({ llm: { ...config.llm, baseUrl: e.target.value } })}
          />
        </div>
        <div>
          <label className="label">Model</label>
          <input
            className="input"
            value={config.llm.model}
            onChange={(e) => setConfig({ ...config, llm: { ...config.llm, model: e.target.value } })}
            onBlur={(e) => void save({ llm: { ...config.llm, model: e.target.value } })}
          />
        </div>
        <div>
          <label className="label">API Key {config.llm.apiKey === "***" && "(已保存，留空表示不修改)"}</label>
          <input
            type="password"
            className="input code"
            value={apiKeyDraft}
            onChange={(e) => setApiKeyDraft(e.target.value)}
            placeholder={config.llm.apiKey === "***" ? "已保存，留空表示不修改" : "sk-..."}
          />
          <button
            className="btn btn-primary mt-2"
            onClick={async () => {
              if (!apiKeyDraft) return;
              await save({ llm: { ...config.llm, apiKey: apiKeyDraft } });
              setApiKeyDraft("");
            }}
          >
            保存 API Key
          </button>
        </div>
      </section>

      <section className="surface p-6 space-y-4">
        <h2 className="font-semibold">云 OCR</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.ocr.cloudEnabled}
            onChange={(e) => void save({ ocr: { cloudEnabled: e.target.checked } })}
          />
          启用云端 OCR（仅扫描版 PDF；整页图像会上传至所配置的 OCR 服务）
        </label>
      </section>

      <section className="surface p-6 space-y-4">
        <h2 className="font-semibold">保留策略</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.retention.keepUploads}
            onChange={(e) =>
              void save({ retention: { ...config.retention, keepUploads: e.target.checked } })
            }
          />
          保留稿件副本以便复核
        </label>
        <div>
          <label className="label">自动清理超过多少小时的上传（默认 24）</label>
          <input
            type="number"
            min={1}
            max={720}
            className="input"
            value={config.retention.keepHours}
            onChange={(e) =>
              setConfig({
                ...config,
                retention: { ...config.retention, keepHours: Number(e.target.value) },
              })
            }
            onBlur={(e) =>
              void save({
                retention: { ...config.retention, keepHours: Number(e.target.value) },
              })
            }
          />
        </div>
      </section>

      {status && <div className="text-sm text-emerald-300">{status}</div>}
    </div>
  );
}
