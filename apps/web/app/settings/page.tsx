"use client";

import { useEffect, useReducer, useState } from "react";
import {
  Brain,
  Eye,
  EyeSlash,
  Image as ImageIcon,
  FloppyDisk,
  ShieldCheck,
  Clock,
  Sparkle,
  TrashSimple,
  GlobeHemisphereWest,
  type Icon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

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
  enrichment: { enabled: boolean };
}

type Action =
  | { type: "set"; config: PublicConfig }
  | { type: "patchLlm"; partial: Partial<PublicConfig["llm"]> }
  | { type: "patchOcr"; partial: Partial<PublicConfig["ocr"]> }
  | { type: "patchRetention"; partial: Partial<PublicConfig["retention"]> }
  | { type: "patchEnrichment"; partial: Partial<PublicConfig["enrichment"]> };

function reducer(state: PublicConfig | null, action: Action): PublicConfig | null {
  if (action.type === "set") return action.config;
  if (!state) return state;
  if (action.type === "patchLlm")
    return { ...state, llm: { ...state.llm, ...action.partial } };
  if (action.type === "patchOcr")
    return { ...state, ocr: { ...state.ocr, ...action.partial } };
  if (action.type === "patchRetention")
    return { ...state, retention: { ...state.retention, ...action.partial } };
  if (action.type === "patchEnrichment")
    return { ...state, enrichment: { ...state.enrichment, ...action.partial } };
  return state;
}

export default function SettingsPage() {
  const [config, dispatch] = useReducer(reducer, null);
  // null = still loading; "forbidden" = non-admin (we hide admin-only cards
  // but still render the per-user cards). Anything else = loaded admin view.
  const [adminAccess, setAdminAccess] = useState<"loading" | "ok" | "forbidden">(
    "loading",
  );
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    void fetch("/api/settings").then(async (res) => {
      if (!res.ok) {
        // 401/403 — regular user. Hide admin-only cards, but per-user cards
        // (UserLlmCard / UserEnrichmentCard) still render below.
        setAdminAccess("forbidden");
        return;
      }
      const c = (await res.json()) as PublicConfig;
      dispatch({ type: "set", config: c });
      setAdminAccess("ok");
    });
  }, []);

  if (adminAccess === "loading") {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  async function save(partial: Partial<PublicConfig>) {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
    if (!res.ok) {
      toast.error("保存失败：" + (await res.text()));
      return;
    }
    const next = (await res.json()) as PublicConfig;
    dispatch({ type: "set", config: next });
    toast.success("已保存");
  }

  return (
    <div className="max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">设置</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          所有解析默认在本地完成。启用下方开关才会发起出网请求。API Key 仅保存在服务端配置文件，不会写入 git，也不会回到前端。
        </p>
      </header>

      <UserLlmCard />

      <UserEnrichmentCard />

      {config && (<>
      <SettingsCard icon={Brain} title="LLM 增强（系统默认）" sub="所有未单独配置的用户使用这一份配置。启用 LLM 才会发起出网请求">
        <ToggleRow
          label="启用 LLM 参考文献增强解析"
          checked={config.llm.enabled}
          onChange={(v) => {
            dispatch({ type: "patchLlm", partial: { enabled: v } });
            void save({ llm: { ...config.llm, enabled: v } });
          }}
        />
        <ToggleRow
          label="启用 LLM 首页元数据增强（更耗 token）"
          checked={config.llm.enableHeaderParse}
          disabled={!config.llm.enabled}
          onChange={(v) => {
            dispatch({ type: "patchLlm", partial: { enableHeaderParse: v } });
            void save({ llm: { ...config.llm, enableHeaderParse: v } });
          }}
        />

        <Separator />

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="baseUrl">Base URL</Label>
            <Input
              id="baseUrl"
              value={config.llm.baseUrl}
              onChange={(e) =>
                dispatch({ type: "patchLlm", partial: { baseUrl: e.target.value } })
              }
              onBlur={(e) =>
                void save({ llm: { ...config.llm, baseUrl: e.target.value } })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              className="font-mono"
              value={config.llm.model}
              onChange={(e) =>
                dispatch({ type: "patchLlm", partial: { model: e.target.value } })
              }
              onBlur={(e) =>
                void save({ llm: { ...config.llm, model: e.target.value } })
              }
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="apiKey" className="flex items-center gap-2">
            API Key
            {config.llm.apiKey === "***" && (
              <span className="text-success text-xs font-normal">· 已保存</span>
            )}
          </Label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                id="apiKey"
                type={showApiKey ? "text" : "password"}
                className="font-mono pr-10"
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                placeholder={
                  config.llm.apiKey === "***" ? "留空表示不修改" : "sk-..."
                }
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                aria-label="toggle visibility"
              >
                {showApiKey ? (
                  <EyeSlash className="h-4 w-4" weight="duotone" />
                ) : (
                  <Eye className="h-4 w-4" weight="duotone" />
                )}
              </button>
            </div>
            <Button
              disabled={!apiKeyDraft}
              onClick={async () => {
                if (!apiKeyDraft) return;
                await save({ llm: { ...config.llm, apiKey: apiKeyDraft } });
                setApiKeyDraft("");
              }}
            >
              <FloppyDisk className="h-4 w-4" weight="bold" />
              保存 Key
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            服务端持久化路径：
            <code className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              ~/.config/rw-screen/config.json
            </code>
          </p>
        </div>
      </SettingsCard>

      <SettingsCard
        icon={GlobeHemisphereWest}
        title="外源元数据增强"
        sub="启用后参考文献会调用 Crossref / Europe PMC 反查 DOI，显著提升双栏 PDF 的命中率。需要填一个联系邮箱（Crossref polite pool 要求）"
      >
        <ToggleRow
          label="启用 Crossref / Europe PMC 反查 DOI"
          checked={config.enrichment.enabled}
          onChange={(v) => {
            dispatch({ type: "patchEnrichment", partial: { enabled: v } });
            void save({ enrichment: { ...config.enrichment, enabled: v } });
          }}
        />
        <p className="text-[11px] text-muted-foreground">
          每位用户在
          <span className="font-mono mx-1">&ldquo;我的外源邮箱配置&rdquo;</span>
          卡里填自己的联系邮箱，其稿件解析时使用各自的邮箱进行 Crossref / EPMC polite-pool 调用。整站不再共用一个邮箱。
        </p>
      </SettingsCard>

      <SettingsCard icon={ImageIcon} title="云端 OCR" sub="仅扫描版 PDF 才会触发；本地默认走 tesseract.js">
        <ToggleRow
          label="启用云端 OCR（整页图像会上传至所配置的服务）"
          checked={config.ocr.cloudEnabled}
          onChange={(v) => {
            dispatch({ type: "patchOcr", partial: { cloudEnabled: v } });
            void save({ ocr: { cloudEnabled: v } });
          }}
        />
      </SettingsCard>

      <SettingsCard icon={Clock} title="保留策略" sub="上传的稿件副本与解析结果如何保留">
        <ToggleRow
          label="保留稿件副本以便复核"
          checked={config.retention.keepUploads}
          onChange={(v) => {
            dispatch({ type: "patchRetention", partial: { keepUploads: v } });
            void save({ retention: { ...config.retention, keepUploads: v } });
          }}
        />
        <div className="space-y-1.5">
          <Label htmlFor="keepHours">自动清理超过多少小时的上传</Label>
          <Input
            id="keepHours"
            type="number"
            min={1}
            max={720}
            value={config.retention.keepHours}
            onChange={(e) =>
              dispatch({
                type: "patchRetention",
                partial: { keepHours: Number(e.target.value) },
              })
            }
            onBlur={(e) =>
              void save({
                retention: {
                  ...config.retention,
                  keepHours: Number(e.target.value),
                },
              })
            }
          />
        </div>
      </SettingsCard>

      <Card className="bg-muted/30">
        <CardContent className="p-4 flex items-start gap-3 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-success mt-0.5 shrink-0" weight="duotone" />
          <p>
            <span className="text-foreground font-medium">隐私小贴士：</span>
            API Key 永远只在服务端持久化，不会回到前端、不会写入 git。可以通过环境变量
            <code className="mx-1 rounded bg-background px-1.5 py-0.5 font-mono">
              DEEPSAPI_API_KEY
            </code>
            注入而不依赖 UI 配置。
          </p>
        </CardContent>
      </Card>
      </>)}
    </div>
  );
}

function SettingsCard({
  icon: Icon,
  title,
  sub,
  children,
}: {
  icon: Icon;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-muted text-foreground">
            <Icon className="h-4 w-4" weight="duotone" />
          </span>
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="text-xs mt-0.5">{sub}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

interface UserLlmConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  enableHeaderParse: boolean;
  hasApiKey: boolean;
}

function UserLlmCard() {
  const [cfg, setCfg] = useState<UserLlmConfig | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    void fetch("/api/account/llm").then(async (res) => {
      if (!res.ok) return;
      setCfg((await res.json()) as UserLlmConfig);
    });
  }, []);

  if (!cfg) return <Skeleton className="h-64 w-full" />;

  async function patch(partial: Partial<UserLlmConfig>) {
    const res = await fetch("/api/account/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
    if (!res.ok) {
      toast.error("保存失败");
      return;
    }
    setCfg((await res.json()) as UserLlmConfig);
    toast.success("已保存");
  }

  async function clearAll() {
    if (!confirm("清除你的私人 LLM 配置？之后会回退使用系统默认配置。")) return;
    const res = await fetch("/api/account/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clear: true }),
    });
    if (!res.ok) {
      toast.error("操作失败");
      return;
    }
    setCfg((await res.json()) as UserLlmConfig);
    setKeyDraft("");
    toast.success("已清除");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
            <Sparkle className="h-4 w-4" weight="duotone" />
          </span>
          <div className="flex-1">
            <CardTitle className="text-base">我的 LLM 配置（覆盖系统默认）</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              如果你填了，解析时优先使用你的 key 和模型；留空则回退到系统默认。
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-md border bg-card px-4 py-3">
          <Label className="text-sm flex-1">启用我的私人 LLM 配置</Label>
          <Switch
            checked={cfg.enabled}
            onCheckedChange={(v) => void patch({ enabled: v })}
          />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md border bg-card px-4 py-3">
          <Label className="text-sm flex-1">启用 LLM 首页元数据增强</Label>
          <Switch
            checked={cfg.enableHeaderParse}
            disabled={!cfg.enabled}
            onCheckedChange={(v) => void patch({ enableHeaderParse: v })}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="userBaseUrl">Base URL</Label>
            <Input
              id="userBaseUrl"
              value={cfg.baseUrl}
              placeholder="https://api.deepseek.com/v1"
              onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })}
              onBlur={(e) => void patch({ baseUrl: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="userModel">Model</Label>
            <Input
              id="userModel"
              className="font-mono"
              value={cfg.model}
              placeholder="deepseek-v4-flash"
              onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
              onBlur={(e) => void patch({ model: e.target.value })}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="userApiKey" className="flex items-center gap-2">
            API Key
            {cfg.hasApiKey && (
              <span className="text-success text-xs font-normal">· 已保存</span>
            )}
          </Label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                id="userApiKey"
                type={showKey ? "text" : "password"}
                className="font-mono pr-10"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder={cfg.hasApiKey ? "留空表示不修改" : "sk-..."}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                aria-label="toggle visibility"
              >
                {showKey ? (
                  <EyeSlash className="h-4 w-4" weight="duotone" />
                ) : (
                  <Eye className="h-4 w-4" weight="duotone" />
                )}
              </button>
            </div>
            <Button
              disabled={!keyDraft}
              onClick={async () => {
                if (!keyDraft) return;
                await patch({ apiKey: keyDraft });
                setKeyDraft("");
              }}
            >
              <FloppyDisk className="h-4 w-4" weight="bold" />
              保存 Key
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            私人配置存在 users 表的 llm_settings_json 列；只有你自己能读到，不会回到前端明文。
          </p>
        </div>

        <Separator />

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={clearAll} className="text-destructive">
            <TrashSimple className="h-4 w-4" weight="duotone" />
            清除我的私人配置
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface UserEnrichmentConfig {
  contactEmail: string;
  hasContactEmail: boolean;
}

function UserEnrichmentCard() {
  const [cfg, setCfg] = useState<UserEnrichmentConfig | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    void fetch("/api/account/enrichment").then(async (res) => {
      if (!res.ok) return;
      const j = (await res.json()) as UserEnrichmentConfig;
      setCfg(j);
      setDraft(j.contactEmail || "");
    });
  }, []);

  if (!cfg) return <Skeleton className="h-44 w-full" />;

  async function save(value: string) {
    const res = await fetch("/api/account/enrichment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactEmail: value.trim() }),
    });
    if (!res.ok) {
      toast.error("保存失败：" + (await res.text()));
      return;
    }
    setCfg((await res.json()) as UserEnrichmentConfig);
    toast.success(value.trim() ? "邮箱已保存" : "邮箱已清空");
  }

  async function clearEmail() {
    if (!confirm("清除你的外源联系邮箱？清除后你上传的稿件将不再走 Crossref / EPMC 反查。"))
      return;
    const res = await fetch("/api/account/enrichment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clear: true }),
    });
    if (!res.ok) {
      toast.error("操作失败");
      return;
    }
    setCfg((await res.json()) as UserEnrichmentConfig);
    setDraft("");
    toast.success("已清除");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
            <GlobeHemisphereWest className="h-4 w-4" weight="duotone" />
          </span>
          <div className="flex-1">
            <CardTitle className="text-base">我的外源邮箱配置</CardTitle>
            <CardDescription className="text-xs mt-0.5">
              用于 Crossref / OpenAlex / Europe PMC 的 polite-pool 联系邮箱。**只跟你账户绑定**，仅在你上传稿件时使用。留空则你的稿件不走外源反查。
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="userContactEmail" className="flex items-center gap-2">
            联系邮箱
            {cfg.hasContactEmail && (
              <span className="text-success text-xs font-normal">· 已保存</span>
            )}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="userContactEmail"
              type="email"
              placeholder="you@example.com"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button
              disabled={draft.trim() === (cfg.contactEmail || "")}
              onClick={() => void save(draft)}
            >
              <FloppyDisk className="h-4 w-4" weight="bold" />
              保存
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            邮箱仅用于满足 Crossref / OpenAlex 的 polite-pool 标识要求；不会被发送邮件，也不会公开。
          </p>
        </div>

        {cfg.hasContactEmail && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearEmail}
              className="text-destructive"
            >
              <TrashSimple className="h-4 w-4" weight="duotone" />
              清除我的邮箱
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ToggleRow({
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
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3">
      <Label className="text-sm flex-1">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
