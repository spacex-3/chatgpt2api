"use client";

import { create } from "zustand";
import { toast } from "sonner";

import { fetchSettingsConfig, updateSettingsConfig, type AuthRole, type SettingsConfig, type SettingsScope } from "@/lib/api";
import { getStoredAuthSession, setStoredAuthSession } from "@/store/auth";

function normalizeConfig(config: SettingsConfig): SettingsConfig {
  return {
    upstream_api_url: typeof config.upstream_api_url === "string" ? config.upstream_api_url : "",
    upstream_api_key: typeof config.upstream_api_key === "string" ? config.upstream_api_key : "",
    upstream_api_key_masked: typeof config.upstream_api_key_masked === "string" ? config.upstream_api_key_masked : "",
    upstream_api_key_configured: Boolean(config.upstream_api_key_configured),
    proxy: typeof config.proxy === "string" ? config.proxy : "",
    base_url: typeof config.base_url === "string" ? config.base_url : "",
    image_retention_days: Number(config.image_retention_days || 30),
    model: "gpt-image-2",
  };
}

type SettingsStore = {
  config: SettingsConfig | null;
  role: AuthRole | null;
  scope: SettingsScope | null;
  isLoadingConfig: boolean;
  isSavingConfig: boolean;
  loadConfig: () => Promise<void>;
  saveConfig: () => Promise<void>;
  setUpstreamApiUrl: (value: string) => void;
  setUpstreamApiKey: (value: string) => void;
  setProxy: (value: string) => void;
  setBaseUrl: (value: string) => void;
  setImageRetentionDays: (value: string) => void;
};

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  config: null,
  role: null,
  scope: null,
  isLoadingConfig: true,
  isSavingConfig: false,

  loadConfig: async () => {
    set({ isLoadingConfig: true });
    try {
      const data = await fetchSettingsConfig();
      set({
        config: normalizeConfig(data.config),
        role: data.role || null,
        scope: data.scope || null,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载设置失败");
    } finally {
      set({ isLoadingConfig: false });
    }
  },

  saveConfig: async () => {
    const { config, scope } = get();
    if (!config) {
      return;
    }
    set({ isSavingConfig: true });
    try {
      const payload = scope === "admin"
        ? {
            ...config,
            upstream_api_url: String(config.upstream_api_url || "").trim(),
            upstream_api_key: String(config.upstream_api_key || "").trim(),
            proxy: String(config.proxy || "").trim(),
            base_url: String(config.base_url || "").trim(),
            image_retention_days: Math.max(1, Number(config.image_retention_days) || 30),
          }
        : {
            upstream_api_url: String(config.upstream_api_url || "").trim(),
            upstream_api_key: String(config.upstream_api_key || "").trim(),
          };
      const data = await updateSettingsConfig(payload);
      set({
        config: normalizeConfig(data.config),
        role: data.role || get().role,
        scope: data.scope || scope,
      });
      if (data.session_token && data.subject_id && data.name) {
        const current = await getStoredAuthSession();
        if (current) {
          await setStoredAuthSession({
            ...current,
            key: data.session_token,
            subjectId: data.subject_id,
            name: data.name,
          });
        }
      }
      toast.success("设置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存设置失败");
    } finally {
      set({ isSavingConfig: false });
    }
  },

  setUpstreamApiUrl: (value) => {
    set((state) => state.config ? { config: { ...state.config, upstream_api_url: value } } : {});
  },

  setUpstreamApiKey: (value) => {
    set((state) => state.config ? { config: { ...state.config, upstream_api_key: value } } : {});
  },

  setProxy: (value) => {
    set((state) => state.config ? { config: { ...state.config, proxy: value } } : {});
  },

  setBaseUrl: (value) => {
    set((state) => state.config ? { config: { ...state.config, base_url: value } } : {});
  },

  setImageRetentionDays: (value) => {
    set((state) => state.config ? { config: { ...state.config, image_retention_days: value } } : {});
  },
}));
