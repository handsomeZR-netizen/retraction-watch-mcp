"use client";

import { useEffect, useReducer, useState } from "react";
import {
  Brain,
  Check,
  Clock,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Save,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

type Action =
  | { type: "set"; config: PublicConfig }
  | { type: "patchLlm"; partial: Partial<PublicConfig["llm"]> }
  | { type: "patchOcr"; partial: Partial<PublicConfig["ocr"]> }
  | { type: "patchRetention"; partial: Partial<PublicConfig["retention"]> };

function reducer(state: PublicConfig | null, action: Action): PublicConfig | null {
  if (action.type === "set") return action.config;
  if (!state) return state;
  if (action.type === "patchLlm")
    return { ...state, llm: { ...state.llm, ...action.partial } };
  if (action.type === "patchOcr")
    return { ...state, ocr: { ...state.ocr, ...action.partial } };
  if (action.type === "patchRetention")
    return { ...state, retention: { ...state.retention, ...action.partial } };
  return state;
}

export default function SettingsPage() {
  const [config, dispatch] = useReducer(reducer, null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  useEffect(() => {
    void fetch("/api/settings").then(async (res) => {
      const c = (await res.json()) as PublicConfig;
      dispatch({ type: "set", config: c });
    });
  }, []);

  if (!config) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-8 w-40" />
        <div className="skeleton h-32 w-full" />
        <div className="skeleton h-32 w-full" />
      </div>
    );
  }

  async function save(partial: Partial<PublicConfig>) {
    setStatus(null);
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
    if (!res.ok) {
      setStatus({ kind: "err", msg: "保存失败：" + (await res.text()) });
      return;
    }
    const next = (await res.json()) as PublicConfig;
    dispatch({ type: "set", config: next });
    setStatus({ kind: "ok", msg: "已保存" });
    setTimeout(() => setStatus(null), 1800);
  }

  return (
    <div className="max-w-3xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">设置</h1>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          所有解析默认在本地完成；只有打开下面的开关才会发起出网请求。API Key 仅保存在服务端配置文件，不会进入 git 也不会回包前端。
        </p>
      </header>

      <SettingsCard
        icon={Brain}
        title="LLM 增强"
        sub="DeepSeek / OpenAI 兼容服务，用于结构化抽取无 DOI 的参考文献"
      >
        <Toggle
          label="启用 LLM 参考文献增强解析"
          checked={config.llm.enabled}
          onChange={(v) => {
            dispatch({ type: "patchLlm", partial: { enabled: v } });
            void save({ llm: { ...config.llm, enabled: v } });
          }}
        />
        <Toggle
          label="启用 LLM 首页元数据增强（更耗 token）"
          checked={config.llm.enableHeaderParse}
          disabled={!config.llm.enabled}
          onChange={(v) => {
            dispatch({ type: "patchLlm", partial: { enableHeaderParse: v } });
            void save({ llm: { ...config.llm, enableHeaderParse: v } });
          }}
        />

        <div className="grid sm:grid-cols-2 gap-3 mt-2">
          <div>
            <label className="label">Base URL</label>
            <input
              className="input"
              value={config.llm.baseUrl}
              onChange={(e) =>
                dispatch({ type: "patchLlm", partial: { baseUrl: e.target.value } })
              }
              onBlur={(e) =>
                void save({ llm: { ...config.llm, baseUrl: e.target.value } })
              }
            />
          </div>
          <div>
            <label className="label">Model</label>
            <input
              className="input code"
              value={config.llm.model}
              onChange={(e) =>
                dispatch({ type: "patchLlm", partial: { model: e.target.value } })
              }
              onBlur={(e) => void save({ llm: { ...config.llm, model: e.target.value } })}
            />
          </div>
        </div>

        <div>
          <label className="label">
            API Key{" "}
            {config.llm.apiKey === "***" && (
              <span className="text-success font-normal text-xs">· 已保存</span>
            )}
          </label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showApiKey ? "text" : "password"}
                className="input code !pr-10"
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                placeholder={
                  config.llm.apiKey === "***" ? "留空表示不修改" : "sk-..."
                }
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground"
                aria-label="toggle visibility"
              >
                {showApiKey ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            <button
              className="btn btn-primary"
              disabled={!apiKeyDraft}
              onClick={async () => {
                if (!apiKeyDraft) return;
                await save({ llm: { ...config.llm, apiKey: apiKeyDraft } });
                setApiKeyDraft("");
              }}
            >
              <Save className="w-4 h-4" />
              保存 Key
            </button>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1.5">
            服务端持久化路径：<code className="code">~/.config/rw-screen/config.json</code>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        icon={ImageIcon}
        title="云端 OCR"
        sub="仅扫描版 PDF 才会触发；本地默认走 tesseract.js"
      >
        <Toggle
          label="启用云端 OCR（整页图像会上传至所配置的服务）"
          checked={config.ocr.cloudEnabled}
          onChange={(v) => {
            dispatch({ type: "patchOcr", partial: { cloudEnabled: v } });
            void save({ ocr: { cloudEnabled: v } });
          }}
        />
      </SettingsCard>

      <SettingsCard
        icon={Clock}
        title="保留策略"
        sub="上传的稿件副本与解析结果如何保留"
      >
        <Toggle
          label="保留稿件副本以便复核"
          checked={config.retention.keepUploads}
          onChange={(v) => {
            dispatch({ type: "patchRetention", partial: { keepUploads: v } });
            void save({ retention: { ...config.retention, keepUploads: v } });
          }}
        />
        <div>
          <label className="label">自动清理超过多少小时的上传</label>
          <input
            type="number"
            min={1}
            max={720}
            className="input"
            value={config.retention.keepHours}
            onChange={(e) =>
              dispatch({
                type: "patchRetention",
                partial: { keepHours: Number(e.target.value) },
              })
            }
            onBlur={(e) =>
              void save({
                retention: { ...config.retention, keepHours: Number(e.target.value) },
              })
            }
          />
        </div>
      </SettingsCard>

      <div className="surface px-4 py-3 text-xs text-muted-foreground flex items-start gap-2">
        <ShieldCheck className="w-4 h-4 text-success mt-0.5 shrink-0" />
        <div>
          <span className="text-foreground font-medium">隐私小贴士</span>
          ：API Key 永远只在服务端持久化，不会回包到前端、不会写入 git。可以通过环境变量
          <code className="code mx-1">DEEPSAPI_API_KEY</code>
          注入而不依赖 UI 配置。
        </div>
      </div>

      {status && (
        <div
          className={cn(
            "fixed bottom-6 right-6 surface px-4 py-2.5 text-sm flex items-center gap-2 fade-in-up",
            status.kind === "ok"
              ? "border-success/30 bg-success/10 text-success"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {status.kind === "ok" && <Check className="w-4 h-4" />}
          {status.msg}
        </div>
      )}
    </div>
  );
}

function SettingsCard({
  icon: Icon,
  title,
  sub,
  children,
}: {
  icon: typeof Brain;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <section className="surface p-6 space-y-4">
      <header className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="w-4 h-4" strokeWidth={2} />
        </span>
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
        </div>
      </header>
      <div className="divider" />
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-center justify-between gap-3 px-3 py-2.5 rounded-md surface-2 cursor-pointer hover:border-ring/40 transition-colors",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <span className="text-sm text-foreground">{label}</span>
      <span className="switch" data-checked={checked}>
        <input
          type="checkbox"
          className="sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="switch-track" />
        <span className="switch-thumb" />
      </span>
    </label>
  );
}
