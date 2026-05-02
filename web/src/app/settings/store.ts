"use client";

import { create } from "zustand";
import { toast } from "sonner";

import { fetchSettingsConfig, updateSettingsConfig, type SettingsConfig } from "@/lib/api";

function normalizeConfig(config: SettingsConfig): SettingsConfig {
  return {
    upstream_api_url: typeof config.upstream_api_url === "string" ? config.upstream_api_url : "",
    upstream_api_key: typeof config.upstream_api_key === "string" ? config.upstream_api_key : "",
    proxy: typeof config.proxy === "string" ? config.proxy : "",
    base_url: typeof config.base_url === "string" ? config.base_url : "",
    image_retention_days: Number(config.image_retention_days || 30),
    model: "gpt-image-2",
  };
}

type SettingsStore = {
  config: SettingsConfig | null;
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
  isLoadingConfig: true,
  isSavingConfig: false,

  loadConfig: async () => {
    set({ isLoadingConfig: true });
    try {
      const data = await fetchSettingsConfig();
      set({ config: normalizeConfig(data.config) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载设置失败");
    } finally {
      set({ isLoadingConfig: false });
    }
  },

  saveConfig: async () => {
    const { config } = get();
    if (!config) {
      return;
    }
    set({ isSavingConfig: true });
    try {
      const data = await updateSettingsConfig({
        ...config,
        upstream_api_url: String(config.upstream_api_url || "").trim(),
        upstream_api_key: String(config.upstream_api_key || "").trim(),
        proxy: String(config.proxy || "").trim(),
        base_url: String(config.base_url || "").trim(),
        image_retention_days: Math.max(1, Number(config.image_retention_days) || 30),
      });
      set({ config: normalizeConfig(data.config) });
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
