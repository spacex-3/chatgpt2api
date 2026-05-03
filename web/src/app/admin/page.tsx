"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageIcon, LoaderCircle, RefreshCw, Save, Search, XCircle } from "lucide-react";
import { toast } from "sonner";

import { ImageLightbox } from "@/components/image-lightbox";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  fetchAdminImageTaskDetail,
  fetchAdminImageTasks,
  fetchSettingsConfig,
  updateSettingsConfig,
  type ImageTask,
  type ImageTaskImage,
  type ImageTaskPreviewImage,
  type SettingsConfig,
} from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { getStoredAuthSession, setStoredAuthSession } from "@/store/auth";

type AdminTaskFilters = {
  credentialQuery: string;
  mode: "all" | "generate" | "edit";
  updatedFrom: string;
  updatedTo: string;
};

type LightboxImage = {
  id: string;
  src: string;
  sizeLabel?: string;
  dimensions?: string;
};

const DEFAULT_FILTERS: AdminTaskFilters = {
  credentialQuery: "",
  mode: "all",
  updatedFrom: "",
  updatedTo: "",
};

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatCredentialFingerprint(value: string | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > 18 ? `${normalized.slice(0, 10)}...${normalized.slice(-6)}` : normalized;
}

function formatOwnerRole(value: string | undefined) {
  return value === "admin" ? "管理员" : "普通用户";
}

function taskCacheKey(task: Pick<ImageTask, "owner_id" | "id">) {
  return `${String(task.owner_id || "unknown")}:${task.id}`;
}

function normalizeConfig(config: SettingsConfig): SettingsConfig {
  return {
    upstream_api_url: String(config.upstream_api_url || ""),
    upstream_api_key: String(config.upstream_api_key || ""),
    upstream_api_key_masked: String(config.upstream_api_key_masked || ""),
    upstream_api_key_configured: Boolean(config.upstream_api_key_configured),
    env_managed_fields: Array.isArray(config.env_managed_fields)
      ? config.env_managed_fields.filter((item): item is string => typeof item === "string")
      : [],
    proxy: String(config.proxy || ""),
    base_url: String(config.base_url || ""),
    image_retention_days: Number(config.image_retention_days || 30),
    max_images_per_request: Number(config.max_images_per_request || 10),
    model: "gpt-image-2",
  };
}

function getPreviewSrc(image: ImageTaskPreviewImage) {
  return String(image.thumbnail_url || "").trim();
}

function getResultSrc(image: ImageTaskImage) {
  const url = String(image.url || "").trim();
  if (url) {
    return url;
  }
  const b64 = String(image.b64_json || "").trim();
  return b64 ? `data:image/png;base64,${b64}` : "";
}

function buildResultLightboxImages(task: ImageTask): LightboxImage[] {
  return (task.data || []).flatMap((image, index) => {
    const src = getResultSrc(image);
    if (!src) {
      return [];
    }
    return [{ id: `${task.id}-result-${index}`, src }];
  });
}

function buildSourceLightboxImages(task: ImageTask): LightboxImage[] {
  return (task.source_images || []).flatMap((image, index) => {
    const src = String(image.url || "").trim();
    if (!src) {
      return [];
    }
    return [{ id: `${task.id}-source-${index}`, src }];
  });
}

function PreviewGrid({
  images,
  emptyText,
  onOpen,
}: {
  images: ImageTaskPreviewImage[];
  emptyText: string;
  onOpen: (index: number) => void;
}) {
  if (images.length === 0) {
    return (
      <div className="flex min-h-20 items-center justify-center rounded-xl border border-dashed border-stone-200 bg-white/70 px-3 py-4 text-xs text-stone-400">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {images.map((image, index) => {
        const src = getPreviewSrc(image);
        if (!src) {
          return (
            <div
              key={image.id || `${index}`}
              className="flex size-20 items-center justify-center rounded-xl border border-dashed border-stone-200 bg-white/70 text-[11px] text-stone-400"
            >
              无缩略图
            </div>
          );
        }
        return (
          <button
            key={image.id || `${index}`}
            type="button"
            onClick={() => onOpen(index)}
            className="group block overflow-hidden rounded-xl border border-stone-200 bg-white"
            aria-label={`预览第 ${index + 1} 张图片`}
          >
            <img
              src={src}
              alt=""
              loading="lazy"
              className="size-20 object-cover transition duration-200 group-hover:brightness-90"
            />
          </button>
        );
      })}
    </div>
  );
}

function AdminPageContent() {
  const [tasks, setTasks] = useState<ImageTask[]>([]);
  const [config, setConfig] = useState<SettingsConfig | null>(null);
  const [filters, setFilters] = useState<AdminTaskFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<AdminTaskFilters>(DEFAULT_FILTERS);
  const [detailCache, setDetailCache] = useState<Record<string, ImageTask>>({});
  const [loadingDetailKey, setLoadingDetailKey] = useState<string | null>(null);
  const [lightboxImages, setLightboxImages] = useState<LightboxImage[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async (nextFilters: AdminTaskFilters) => {
    setIsLoading(true);
    try {
      const [tasksData, settingsData] = await Promise.all([
        fetchAdminImageTasks({
          limit: 200,
          credentialQuery: String(nextFilters.credentialQuery || "").trim(),
          mode: nextFilters.mode === "all" ? undefined : nextFilters.mode,
          updatedFrom: nextFilters.updatedFrom || undefined,
          updatedTo: nextFilters.updatedTo || undefined,
        }),
        fetchSettingsConfig(),
      ]);
      setTasks(tasksData.items);
      setConfig(normalizeConfig(settingsData.config));
      setAppliedFilters(nextFilters);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载管理记录失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(DEFAULT_FILTERS);
  }, [load]);

  const stats = useMemo(() => ({
    total: tasks.length,
    success: tasks.filter((item) => item.status === "success").length,
    error: tasks.filter((item) => item.status === "error").length,
    running: tasks.filter((item) => item.status === "queued" || item.status === "running").length,
  }), [tasks]);
  const envManagedFields = useMemo(() => new Set(config?.env_managed_fields || []), [config?.env_managed_fields]);
  const isEnvManaged = (field: string) => envManagedFields.has(field);
  const adminApiKeyHint = isEnvManaged("upstream_api_key")
    ? `当前由环境变量控制${config?.upstream_api_key_masked ? `（${config.upstream_api_key_masked}）` : ""}，需修改部署环境并重启容器后生效。`
    : String(config?.upstream_api_key || "").trim()
      ? "已输入新的 API Key，保存后会替换当前已配置值。"
      : config?.upstream_api_key_configured
        ? `当前已配置 ${config.upstream_api_key_masked || "API Key"}；留空则保持原值。`
        : "当前未配置；请输入可用的 API Key。";

  const save = useCallback(async () => {
    if (!config) {
      return;
    }
    setIsSaving(true);
    try {
      const data = await updateSettingsConfig({
        ...config,
        upstream_api_url: String(config.upstream_api_url || "").trim(),
        upstream_api_key: String(config.upstream_api_key || "").trim(),
        proxy: String(config.proxy || "").trim(),
        base_url: String(config.base_url || "").trim(),
        image_retention_days: Math.max(1, Number(config.image_retention_days) || 30),
        max_images_per_request: Math.min(10, Math.max(1, Number(config.max_images_per_request) || 10)),
      });
      setConfig(normalizeConfig(data.config));
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
      setIsSaving(false);
    }
  }, [config]);

  const ensureTaskDetail = useCallback(async (task: ImageTask) => {
    const key = taskCacheKey(task);
    const cached = detailCache[key];
    if (cached?.data || (cached?.source_images || []).some((item) => Boolean(item.url))) {
      return cached;
    }
    setLoadingDetailKey(key);
    try {
      const response = await fetchAdminImageTaskDetail(String(task.owner_id || ""), task.id);
      setDetailCache((current) => ({ ...current, [key]: response.item }));
      return response.item;
    } finally {
      setLoadingDetailKey((current) => (current === key ? null : current));
    }
  }, [detailCache]);

  const openTaskLightbox = useCallback(async (task: ImageTask, type: "results" | "sources", index: number) => {
    try {
      const detail = await ensureTaskDetail(task);
      const images = type === "sources" ? buildSourceLightboxImages(detail) : buildResultLightboxImages(detail);
      if (images.length === 0) {
        toast.error(type === "sources" ? "该任务暂无可查看的原图大图" : "该任务暂无可查看的大图");
        return;
      }
      setLightboxImages(images);
      setLightboxIndex(Math.max(0, Math.min(index, images.length - 1)));
      setLightboxOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载图片详情失败");
    }
  }, [ensureTaskDetail]);

  const handleApplyFilters = useCallback(() => {
    void load(filters);
  }, [filters, load]);

  const handleResetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    void load(DEFAULT_FILTERS);
  }, [load]);

  return (
    <>
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 pb-8 pt-3 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["匹配任务", stats.total],
            ["成功", stats.success],
            ["失败", stats.error],
            ["进行中", stats.running],
          ].map(([label, value]) => (
            <Card key={String(label)} className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
              <CardContent className="p-5">
                <div className="text-sm text-stone-500">{label}</div>
                <div className="mt-2 text-3xl font-semibold tracking-tight text-stone-900">{value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>管理员设置</CardTitle>
            <Button variant="outline" className="rounded-xl" onClick={() => void load(appliedFilters)} disabled={isLoading}>
              {isLoading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              刷新
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {envManagedFields.size > 0 ? (
              <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                部分全局项当前由环境变量控制，界面内已锁定；如需修改，请更新部署环境后重启容器。
              </div>
            ) : null}
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm text-stone-700">上游 API URL</label>
              <Input
                value={String(config?.upstream_api_url || "")}
                onChange={(event) => setConfig((prev) => prev ? { ...prev, upstream_api_url: event.target.value } : prev)}
                placeholder="https://your-newapi.example.com/v1"
                className="h-10 rounded-xl border-stone-200 bg-white"
                disabled={isEnvManaged("upstream_api_url")}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm text-stone-700">上游 API Key</label>
              <Input
                type="password"
                value={String(config?.upstream_api_key || "")}
                onChange={(event) => setConfig((prev) => prev ? { ...prev, upstream_api_key: event.target.value } : prev)}
                placeholder="sk-..."
                className="h-10 rounded-xl border-stone-200 bg-white"
                disabled={isEnvManaged("upstream_api_key")}
              />
              <p className="text-xs text-stone-500">{adminApiKeyHint}</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-stone-700">图片访问地址</label>
              <Input
                value={String(config?.base_url || "")}
                onChange={(event) => setConfig((prev) => prev ? { ...prev, base_url: event.target.value } : prev)}
                placeholder="https://example.com"
                className="h-10 rounded-xl border-stone-200 bg-white"
                disabled={isEnvManaged("base_url")}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-stone-700">全局代理</label>
              <Input
                value={String(config?.proxy || "")}
                onChange={(event) => setConfig((prev) => prev ? { ...prev, proxy: event.target.value } : prev)}
                placeholder="http://127.0.0.1:7890"
                className="h-10 rounded-xl border-stone-200 bg-white"
                disabled={isEnvManaged("proxy")}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-stone-700">图片保留天数</label>
              <Input
                value={String(config?.image_retention_days || "")}
                onChange={(event) => setConfig((prev) => prev ? { ...prev, image_retention_days: event.target.value } : prev)}
                placeholder="30"
                className="h-10 rounded-xl border-stone-200 bg-white"
                disabled={isEnvManaged("image_retention_days")}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-stone-700">单次最多生成张数</label>
              <Input
                type="number"
                min={1}
                max={10}
                value={String(config?.max_images_per_request || "")}
                onChange={(event) => setConfig((prev) => prev ? { ...prev, max_images_per_request: event.target.value } : prev)}
                placeholder="10"
                className="h-10 rounded-xl border-stone-200 bg-white"
                disabled={isEnvManaged("max_images_per_request")}
              />
              <p className="text-xs text-stone-500">普通用户受这里限制；管理员图片工作台固定允许到 10。</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-stone-700">固定模型</label>
              <Input value="gpt-image-2" disabled className="h-10 rounded-xl border-stone-200 bg-stone-50 text-stone-500" />
            </div>
            <div className="md:col-span-2 flex justify-end">
              <Button className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={() => void save()} disabled={isSaving}>
                {isSaving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                保存设置
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>管理员任务记录</CardTitle>
              <div className="text-sm text-stone-500">最多显示最近 200 条匹配任务；列表默认只加载缩略图。</div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_180px_220px_220px_auto_auto]">
              <div className="space-y-2">
                <label className="text-sm text-stone-700">凭据指纹 / 关键词</label>
                <Input
                  value={filters.credentialQuery}
                  onChange={(event) => setFilters((prev) => ({ ...prev, credentialQuery: event.target.value }))}
                  placeholder="例如后四位 1234 或 credential_id"
                  className="h-10 rounded-xl border-stone-200 bg-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">任务类型</label>
                <select
                  value={filters.mode}
                  onChange={(event) => setFilters((prev) => ({ ...prev, mode: event.target.value as AdminTaskFilters["mode"] }))}
                  className="h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-stone-300"
                >
                  <option value="all">全部</option>
                  <option value="generate">文生图</option>
                  <option value="edit">编辑图</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">更新时间起</label>
                <Input
                  type="datetime-local"
                  value={filters.updatedFrom}
                  onChange={(event) => setFilters((prev) => ({ ...prev, updatedFrom: event.target.value }))}
                  className="h-10 rounded-xl border-stone-200 bg-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">更新时间止</label>
                <Input
                  type="datetime-local"
                  value={filters.updatedTo}
                  onChange={(event) => setFilters((prev) => ({ ...prev, updatedTo: event.target.value }))}
                  className="h-10 rounded-xl border-stone-200 bg-white"
                />
              </div>
              <div className="flex items-end gap-2 xl:justify-end">
                <Button className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={handleApplyFilters} disabled={isLoading}>
                  {isLoading ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
                  筛选
                </Button>
                <Button variant="outline" className="h-10 rounded-xl" onClick={handleResetFilters} disabled={isLoading}>
                  <XCircle className="size-4" />
                  重置
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-stone-500">
                <LoaderCircle className="size-5 animate-spin" />
              </div>
            ) : tasks.length === 0 ? (
              <div className="py-10 text-center text-sm text-stone-500">当前筛选条件下暂无记录</div>
            ) : (
              <div className="space-y-4">
                {tasks.map((task) => {
                  const key = taskCacheKey(task);
                  const resultPreviews = task.preview_images || [];
                  const sourcePreviews = task.source_images || [];
                  const loadingDetail = loadingDetailKey === key;
                  return (
                    <div key={key} className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-500">
                        <span className="font-medium text-stone-800">{task.credential_label || task.owner_name || "unknown"}</span>
                        <span>{formatOwnerRole(task.owner_role)}</span>
                        <span>{task.mode === "edit" ? "编辑图" : "文生图"}</span>
                        <span>{task.status}</span>
                        <span>n={task.n || 1}</span>
                        <span>{task.size || "auto"}</span>
                        <span>{formatTime(task.updated_at)}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                        <span>会话主体：{task.owner_id || "unknown"}</span>
                        <span>凭据指纹：{formatCredentialFingerprint(task.credential_id || task.owner_id)}</span>
                      </div>
                      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-800">{task.prompt || "(无 prompt)"}</div>
                      {task.error ? <div className="mt-2 text-sm text-red-600">{task.error}</div> : null}
                      <div className="mt-4 space-y-4">
                        {task.mode === "edit" ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-xs font-medium text-stone-500">
                              <ImageIcon className="size-4" />
                              原图缩略图
                              {loadingDetail ? <span className="text-stone-400">加载大图中...</span> : null}
                            </div>
                            <PreviewGrid
                              images={sourcePreviews}
                              emptyText="旧记录无原图缩略图"
                              onOpen={(index) => void openTaskLightbox(task, "sources", index)}
                            />
                          </div>
                        ) : null}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs font-medium text-stone-500">
                            <ImageIcon className="size-4" />
                            结果缩略图
                            {loadingDetail ? <span className="text-stone-400">加载大图中...</span> : null}
                          </div>
                          <PreviewGrid
                            images={resultPreviews}
                            emptyText={task.result_count ? "旧记录无结果缩略图" : "暂无结果"}
                            onOpen={(index) => void openTaskLightbox(task, "results", index)}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <ImageLightbox
        images={lightboxImages}
        currentIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={setLightboxIndex}
      />
    </>
  );
}

export default function AdminPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);
  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-stone-500">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  }
  return <AdminPageContent />;
}
