"use client";

import { LoaderCircle, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { useSettingsStore } from "../store";

export function ConfigCard() {
  const config = useSettingsStore((state) => state.config);
  const isLoadingConfig = useSettingsStore((state) => state.isLoadingConfig);
  const isSavingConfig = useSettingsStore((state) => state.isSavingConfig);
  const setUpstreamApiUrl = useSettingsStore((state) => state.setUpstreamApiUrl);
  const setUpstreamApiKey = useSettingsStore((state) => state.setUpstreamApiKey);
  const setProxy = useSettingsStore((state) => state.setProxy);
  const setBaseUrl = useSettingsStore((state) => state.setBaseUrl);
  const setImageRetentionDays = useSettingsStore((state) => state.setImageRetentionDays);
  const saveConfig = useSettingsStore((state) => state.saveConfig);

  if (isLoadingConfig) {
    return (
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="flex items-center justify-center p-10">
          <LoaderCircle className="size-5 animate-spin text-stone-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
      <CardContent className="space-y-5 p-6">
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
          当前平台固定只使用 <strong>gpt-image-2</strong>，并按 NewAPI 转出的标准 OpenAI 绘图接口进行校验与调用。
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm text-stone-700">上游 API URL</label>
            <Input
              value={String(config?.upstream_api_url || "")}
              onChange={(event) => setUpstreamApiUrl(event.target.value)}
              placeholder="https://your-newapi.example.com/v1"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">保存时会自动校验这组上游凭据是否可用。</p>
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm text-stone-700">上游 API Key</label>
            <Input
              type="password"
              value={String(config?.upstream_api_key || "")}
              onChange={(event) => setUpstreamApiKey(event.target.value)}
              placeholder="sk-..."
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-stone-700">图片访问地址</label>
            <Input
              value={String(config?.base_url || "")}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://example.com"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">留空时默认使用当前站点地址拼接本地图片 URL。</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-stone-700">全局代理</label>
            <Input
              value={String(config?.proxy || "")}
              onChange={(event) => setProxy(event.target.value)}
              placeholder="http://127.0.0.1:7890"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">可选，用于访问上游 NewAPI / OpenAI 兼容绘图接口。</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-stone-700">图片保留天数</label>
            <Input
              value={String(config?.image_retention_days || "")}
              onChange={(event) => setImageRetentionDays(event.target.value)}
              placeholder="30"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">自动清理本地缓存图片的保留天数。</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-stone-700">固定模型</label>
            <Input value="gpt-image-2" disabled className="h-10 rounded-xl border-stone-200 bg-stone-50 text-stone-500" />
            <p className="text-xs text-stone-500">已移除其他模型选择和别名。</p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
            onClick={() => void saveConfig()}
            disabled={isSavingConfig}
          >
            {isSavingConfig ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
