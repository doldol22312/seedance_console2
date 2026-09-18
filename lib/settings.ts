import fs from "node:fs";
import path from "node:path";
import { OUTPUTS_DIR, SETTINGS_FILE, ensureDataDirs } from "./paths";
import type { Provider, ProviderConfig, PublicProviderConfig, PublicSettings, Settings } from "./types";

export const PROVIDER_DEFAULTS: Record<Provider, ProviderConfig> = {
  ark: {
    apiKey: "",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seedance-2-5-260628",
  },
  dashscope: {
    apiKey: "",
    baseUrl: "https://dashscope-intl.aliyuncs.com",
    model: "wan3.0-video",
  },
};

type SettingsFile = {
  provider?: Provider;
  outputsDir?: string;
  providers?: Partial<Record<Provider, Partial<ProviderConfig>>>;
};

function isProvider(value: unknown): value is Provider {
  return value === "ark" || value === "dashscope";
}

function envConfig(provider: Provider): Partial<ProviderConfig> {
  if (provider === "dashscope") {
    return {
      apiKey: process.env.DASHSCOPE_API_KEY || "",
      baseUrl: process.env.DASHSCOPE_BASE_URL || "",
      model: process.env.DASHSCOPE_MODEL || "",
    };
  }
  return {
    apiKey: process.env.ARK_API_KEY || "",
    baseUrl: process.env.ARK_BASE_URL || "",
    model: process.env.ARK_MODEL || "",
  };
}

function readRaw(): { legacy: Partial<ProviderConfig>; file: SettingsFile } {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return { legacy: {}, file: {} };
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) as Record<string, unknown>;
    if (parsed.providers && typeof parsed.providers === "object") {
      return { legacy: {}, file: parsed as SettingsFile };
    }
    // Legacy flat format (single provider).
    return {
      legacy: parsed as Partial<ProviderConfig>,
      file: {},
    };
  } catch {
    return { legacy: {}, file: {} };
  }
}

function legacyProvider(legacy: Partial<ProviderConfig>): Provider {
  const base = (legacy.baseUrl || "").toLowerCase();
  if (base.includes("dashscope") || base.includes("aliyuncs") || base.includes("maas")) {
    return "dashscope";
  }
  return "ark";
}

function resolveProviderConfig(provider: Provider): ProviderConfig {
  const { legacy, file } = readRaw();
  const stored = (file.providers || {})[provider] || {};
  const legacyOwner = legacyProvider(legacy);
  const inherited = legacyOwner === provider ? legacy : {};
  const env = envConfig(provider);
  const defaults = PROVIDER_DEFAULTS[provider];

  return {
    apiKey: (stored.apiKey ?? inherited.apiKey ?? env.apiKey ?? "").trim(),
    baseUrl: (stored.baseUrl || inherited.baseUrl || env.baseUrl || defaults.baseUrl).replace(/\/$/, ""),
    model: (stored.model || inherited.model || env.model || defaults.model).trim(),
  };
}

function readProvider(): Provider {
  const { legacy, file } = readRaw();
  if (isProvider(file.provider)) return file.provider;
  const envProvider = process.env.PROVIDER;
  if (isProvider(envProvider)) return envProvider;
  if (Object.keys(legacy).length) return legacyProvider(legacy);
  return "ark";
}

export function getSettings(): Settings {
  const provider = readProvider();
  return { provider, ...resolveProviderConfig(provider) };
}

export function getProviderConfig(provider: Provider): ProviderConfig {
  return resolveProviderConfig(provider);
}

// Where finished MP4 archives and WebM exports are written. Defaults to data/outputs.
export function getOutputsDir(): string {
  const { file } = readRaw();
  const raw = (file.outputsDir || "").trim();
  return raw ? path.resolve(raw) : OUTPUTS_DIR;
}

function toPublic(config: ProviderConfig): PublicProviderConfig {
  return {
    hasKey: Boolean(config.apiKey),
    keyTail: config.apiKey ? config.apiKey.slice(-4) : "",
    baseUrl: config.baseUrl,
    model: config.model,
  };
}

export function toPublicSettings(settings: Settings): PublicSettings {
  const other: Provider = settings.provider === "ark" ? "dashscope" : "ark";
  return {
    provider: settings.provider,
    ...toPublic(settings),
    providers: {
      [settings.provider]: toPublic(settings),
      [other]: toPublic(getProviderConfig(other)),
    } as Record<Provider, PublicProviderConfig>,
    outputsDir: getOutputsDir(),
    outputsDirDefault: OUTPUTS_DIR,
  };
}

export function saveSettings(next: {
  provider?: Provider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  outputsDir?: string;
}) {
  ensureDataDirs();
  const currentProvider = readProvider();
  const provider = isProvider(next.provider) ? next.provider : currentProvider;
  const currentFile = readRaw().file;

  // Start from what is already on disk for both providers.
  const { legacy, file } = readRaw();
  const legacyOwner = legacyProvider(legacy);
  const slots: Record<Provider, ProviderConfig> = {
    ark: resolveProviderConfig("ark"),
    dashscope: resolveProviderConfig("dashscope"),
  };
  // One-time migration of a legacy flat file into its provider slot.
  if (Object.keys(legacy).length && legacyOwner) {
    slots[legacyOwner] = {
      apiKey: (legacy.apiKey || slots[legacyOwner].apiKey).trim(),
      baseUrl: (legacy.baseUrl || slots[legacyOwner].baseUrl).replace(/\/$/, ""),
      model: (legacy.model || slots[legacyOwner].model).trim(),
    };
  }

  // Apply the submitted values to the slot being saved.
  const target = slots[provider];
  if (next.apiKey !== undefined && next.apiKey.trim()) target.apiKey = next.apiKey.trim();
  if (next.baseUrl) target.baseUrl = next.baseUrl.trim().replace(/\/$/, "");
  if (next.model) target.model = next.model.trim();
  if (!target.baseUrl) target.baseUrl = PROVIDER_DEFAULTS[provider].baseUrl;
  if (!target.model) target.model = PROVIDER_DEFAULTS[provider].model;

  const payload: SettingsFile & { providers: Record<Provider, ProviderConfig> } = {
    provider,
    outputsDir:
      next.outputsDir !== undefined
        ? next.outputsDir.trim()
          ? path.resolve(next.outputsDir.trim())
          : ""
        : currentFile.outputsDir || "",
    providers: slots,
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(payload, null, 2));

  const settings: Settings = { provider, ...slots[provider] };
  return toPublicSettings(settings);
}
