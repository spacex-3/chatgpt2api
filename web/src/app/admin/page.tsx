"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  fetchAdminImageTasks,
  fetchSettingsConfig,
  updateSettingsConfig,
  type ImageTask,
  type SettingsConfig,
} from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { getStoredAuthSession, setStoredAuthSession } from "@/store/auth";

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

function imageSrc(item: { url?: string; b64_json?: string }) {
  if (item.url) {
    return item.url;
  }
  if (item.b64_json) {
    return `data:image/png;base64,${item.b64_json}`;
  }
  return "";
}

function normalizeConfig(config: SettingsConfig): SettingsConfig {
  return {
    upstream_api_url: String(config.upstream_api_url || ""),
    upstream_api_key: String(config.upstream_api_key || ""),
    proxy: String(config.proxy || ""),
    base_url: String(config.base_url || ""),
    image_retention_days: Number(config.image_retention_days || 30),
    model: "gpt-image-2",
  };
}

function AdminPageContent() {
  const [tasks, setTasks] = useState<ImageTask[]>([]);
  const [config, setConfig] = useState<SettingsConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [tasksData, settingsData] = await Promise.all([
        fetchAdminImageTasks(200),
        fetchSettingsConfig(),
      ]);
      setTasks(tasksData.items);
      setConfig(normalizeConfig(settingsData.config));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载管理记录失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => ({
    total: tasks.length,
    success: tasks.filter((item) => item.status === "success").length,
    error: tasks.filter((item) => item.status === "error").length,
    running: tasks.filter((item) => item.status === "queued" || item.status === "running").length,
  }), [tasks]);

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

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 pb-8 pt-3 sm:px-6">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["总任务", stats.total],
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
          <Button variant="outline" className="rounded-xl" onClick={() => void load()} disabled={isLoading}>
            {isLoading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            刷新
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm text-stone-700">上游 API URL</label>
            <Input
              value={String(config?.upstream_api_url || "")}
              onChange={(event) => setConfig((prev) => prev ? { ...prev, upstream_api_url: event.target.value } : prev)}
              placeholder="https://your-newapi.example.com/v1"
              className="h-10 rounded-xl border-stone-200 bg-white"
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
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">图片访问地址</label>
            <Input
              value={String(config?.base_url || "")}
              onChange={(event) => setConfig((prev) => prev ? { ...prev, base_url: event.target.value } : prev)}
              placeholder="https://example.com"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">全局代理</label>
            <Input
              value={String(config?.proxy || "")}
              onChange={(event) => setConfig((prev) => prev ? { ...prev, proxy: event.target.value } : prev)}
              placeholder="http://127.0.0.1:7890"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">图片保留天数</label>
            <Input
              value={String(config?.image_retention_days || "")}
              onChange={(event) => setConfig((prev) => prev ? { ...prev, image_retention_days: event.target.value } : prev)}
              placeholder="30"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
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
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>最近 200 条图片任务记录</CardTitle>
          <div className="text-sm text-stone-500">可查看 prompt、状态、图片结果与归属 key</div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-stone-500">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="py-10 text-center text-sm text-stone-500">暂无记录</div>
          ) : (
            <div className="space-y-4">
              {tasks.map((task) => (
                <div key={`${task.owner_id || "owner"}:${task.id}`} className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-500">
                    <span className="font-medium text-stone-800">{task.owner_name || task.owner_id || "unknown"}</span>
                    <span>{task.mode === "edit" ? "编辑图" : "文生图"}</span>
                    <span>{task.status}</span>
                    <span>n={task.n || 1}</span>
                    <span>{task.size || "auto"}</span>
                    <span>{formatTime(task.updated_at)}</span>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-stone-800 whitespace-pre-wrap">{task.prompt || "(无 prompt)"}</div>
                  {task.error ? <div className="mt-2 text-sm text-red-600">{task.error}</div> : null}
                  {(task.data || []).length > 0 ? (
                    <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
                      {(task.data || []).map((item, index) => {
                        const src = imageSrc(item);
                        return src ? (
                          <a key={`${task.id}-${index}`} href={src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-stone-200 bg-white">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt={`${task.id}-${index}`} className="aspect-square h-full w-full object-cover" />
                          </a>
                        ) : (
                          <div key={`${task.id}-${index}`} className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-stone-200 text-xs text-stone-400">
                            无预览
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
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
