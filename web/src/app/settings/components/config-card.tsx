"use client";

import { LoaderCircle, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { useSettingsStore } from "../store";

export function ConfigCard() {
  const config = useSettingsStore((state) => state.config);
  const scope = useSettingsStore((state) => state.scope);
  const isLoadingConfig = useSettingsStore((state) => state.isLoadingConfig);
  const isSavingConfig = useSettingsStore((state) => state.isSavingConfig);
  const setUpstreamApiUrl = useSettingsStore((state) => state.setUpstreamApiUrl);
  const setUpstreamApiKey = useSettingsStore((state) => state.setUpstreamApiKey);
  const setProxy = useSettingsStore((state) => state.setProxy);
  const setBaseUrl = useSettingsStore((state) => state.setBaseUrl);
  const setImageRetentionDays = useSettingsStore((state) => state.setImageRetentionDays);
  const setMaxImagesPerRequest = useSettingsStore((state) => state.setMaxImagesPerRequest);
  const saveConfig = useSettingsStore((state) => state.saveConfig);
  const adminApiKeyHint = String(config?.upstream_api_key || "").trim()
    ? "已输入新的 API Key，保存后会替换当前已配置值。"
    : config?.upstream_api_key_configured
      ? `当前已配置 ${config.upstream_api_key_masked || "API Key"}；留空则保持原值。`
      : "当前未配置；请输入可用的 API Key。";

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
          {scope === "admin"
            ? <>当前平台固定只使用 <strong>gpt-image-2</strong>，并按 NewAPI 转出的标准 OpenAI 绘图接口进行校验与调用。</>
            : <>这里维护的是你当前会话自己的上游绘图凭据；保存后只影响你自己，不会改动管理员的全局配置。</>}
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
            <p className="text-xs text-stone-500">
              {scope === "admin" ? "保存时会自动校验这组上游凭据是否可用。" : "保存后会刷新你当前用户会话使用的上游地址。"}
            </p>
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
            {scope === "admin" ? <p className="text-xs text-stone-500">{adminApiKeyHint}</p> : null}
          </div>

          {scope === "admin" ? (
            <>
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
                <label className="text-sm text-stone-700">单次最多生成张数</label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={String(config?.max_images_per_request || "")}
                  onChange={(event) => setMaxImagesPerRequest(event.target.value)}
                  placeholder="10"
                  className="h-10 rounded-xl border-stone-200 bg-white"
                />
                <p className="text-xs text-stone-500">允许范围 1～10，前台提交数量会按这里的上限限制。</p>
              </div>
            </>
          ) : (
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm text-stone-700">当前服务地址</label>
              <Input
                value={String(config?.base_url || "")}
                disabled
                className="h-10 rounded-xl border-stone-200 bg-stone-50 text-stone-500"
              />
              <p className="text-xs text-stone-500">该地址仅用于当前页面内的链接模板替换，不提供全局管理能力。</p>
            </div>
          )}

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
