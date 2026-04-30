import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface AppConfig {
  llm: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
    enableHeaderParse: boolean;
  };
  ocr: {
    cloudEnabled: boolean;
  };
  retention: {
    keepUploads: boolean;
    keepHours: number;
  };
  enrichment: {
    enabled: boolean;
    contactEmail: string;
  };
}

const DEFAULT_CONFIG: AppConfig = {
  llm: {
    enabled: false,
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    model: "deepseek-v4-flash",
    enableHeaderParse: true,
  },
  ocr: {
    cloudEnabled: false,
  },
  retention: {
    keepUploads: false,
    keepHours: 24,
  },
  enrichment: {
    enabled: true,
    contactEmail: "",
  },
};

export function getConfigDir(): string {
  if (process.env.RW_SCREEN_CONFIG_DIR) {
    return path.resolve(process.env.RW_SCREEN_CONFIG_DIR);
  }
  return path.join(getRuntimeHomeDir(), ".config", "rw-screen");
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

export function getDataDir(): string {
  if (process.env.RW_SCREEN_DATA_DIR) {
    return path.resolve(process.env.RW_SCREEN_DATA_DIR);
  }
  return path.join(getConfigDir(), "manuscripts");
}

let cachedConfig: AppConfig | null = null;
let cachedConfigSource: ConfigSource = "default";
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

/**
 * Where the live LLM config originated from. Lets the UI flag the case where
 * `RW_LLM_API_KEY` (or `DEEPSAPI_API_KEY`) silently flipped LLM on without
 * the operator clicking anything in /settings.
 */
export type ConfigSource = "file" | "env" | "default";

export async function loadConfig(): Promise<AppConfig> {
  if (cachedConfig && Date.now() - cachedAt < CACHE_TTL_MS) return cachedConfig;
  try {
    const text = await fs.readFile(getConfigPath(), "utf8");
    const raw = JSON.parse(text) as Partial<AppConfig>;
    cachedConfig = mergeConfig(raw);
    cachedConfigSource = "file";
  } catch {
    const overrides = envOverrides();
    cachedConfig = mergeConfig(overrides);
    cachedConfigSource = overrides.llm ? "env" : "default";
  }
  cachedAt = Date.now();
  return cachedConfig;
}

export async function loadConfigSource(): Promise<ConfigSource> {
  await loadConfig();
  return cachedConfigSource;
}

export async function saveConfig(input: Partial<AppConfig>): Promise<AppConfig> {
  const merged = mergeConfig({ ...(cachedConfig ?? DEFAULT_CONFIG), ...input });
  await fs.mkdir(getConfigDir(), { recursive: true });
  await fs.writeFile(getConfigPath(), JSON.stringify(merged, null, 2));
  cachedConfig = merged;
  cachedConfigSource = "file";
  cachedAt = Date.now();
  return merged;
}

export function publicConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    llm: { ...config.llm, apiKey: config.llm.apiKey ? "***" : "" },
  };
}

function mergeConfig(raw: Partial<AppConfig>): AppConfig {
  return {
    llm: {
      ...DEFAULT_CONFIG.llm,
      ...(raw.llm ?? {}),
    },
    ocr: {
      ...DEFAULT_CONFIG.ocr,
      ...(raw.ocr ?? {}),
    },
    retention: {
      ...DEFAULT_CONFIG.retention,
      ...(raw.retention ?? {}),
    },
    enrichment: {
      ...DEFAULT_CONFIG.enrichment,
      ...(raw.enrichment ?? {}),
    },
  };
}

function envOverrides(): Partial<AppConfig> {
  const overrides: Partial<AppConfig> = {};
  if (process.env.DEEPSAPI_API_KEY || process.env.RW_LLM_API_KEY) {
    overrides.llm = {
      ...DEFAULT_CONFIG.llm,
      enabled: true,
      apiKey: (process.env.DEEPSAPI_API_KEY ?? process.env.RW_LLM_API_KEY ?? "").trim(),
      baseUrl: process.env.RW_LLM_BASE_URL ?? DEFAULT_CONFIG.llm.baseUrl,
      model: process.env.RW_LLM_MODEL ?? DEFAULT_CONFIG.llm.model,
      enableHeaderParse: true,
    };
  }
  if (process.env.RW_CONTACT_EMAIL || process.env.RW_USE_ENRICHED_PIPELINE === "0") {
    overrides.enrichment = {
      ...DEFAULT_CONFIG.enrichment,
      enabled: process.env.RW_USE_ENRICHED_PIPELINE !== "0",
      contactEmail: (process.env.RW_CONTACT_EMAIL ?? "").trim(),
    };
  }
  return overrides;
}

function getRuntimeHomeDir(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
}
