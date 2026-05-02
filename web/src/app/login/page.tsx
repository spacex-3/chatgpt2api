"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Globe, KeyRound, LoaderCircle, LockKeyhole } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { login } from "@/lib/api";
import { useRedirectIfAuthenticated } from "@/lib/use-auth-guard";
import { getDefaultRouteForRole, setStoredAuthSession } from "@/store/auth";

export default function LoginPage() {
  const router = useRouter();
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isCheckingAuth } = useRedirectIfAuthenticated();

  const handleLogin = async () => {
    const normalizedApiUrl = apiUrl.trim();
    const normalizedApiKey = apiKey.trim();
    if (!normalizedApiUrl) {
      toast.error("请输入上游 API URL");
      return;
    }
    if (!normalizedApiKey) {
      toast.error("请输入上游 API Key");
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await login(normalizedApiUrl, normalizedApiKey);
      await setStoredAuthSession({
        key: data.session_token,
        role: data.role,
        subjectId: data.subject_id,
        name: data.name,
      });
      router.replace(getDefaultRouteForRole(data.role));
    } catch (error) {
      const message = error instanceof Error ? error.message : "登录失败";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingAuth) {
    return (
      <div className="grid min-h-[calc(100vh-1rem)] w-full place-items-center px-4 py-6">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <div className="grid min-h-[calc(100vh-1rem)] w-full place-items-center px-4 py-6">
      <Card className="w-full max-w-[560px] rounded-[30px] border-white/80 bg-white/95 shadow-[0_28px_90px_rgba(28,25,23,0.10)]">
        <CardContent className="space-y-7 p-6 sm:p-8">
          <div className="space-y-4 text-center">
            <div className="mx-auto inline-flex size-14 items-center justify-center rounded-[18px] bg-stone-950 text-white shadow-sm">
              <LockKeyhole className="size-5" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-stone-950">连接上游绘图接口</h1>
              <p className="text-sm leading-6 text-stone-500">
                输入 NewAPI 转出的标准 OpenAI 绘图接口地址与 API Key，验证通过后进入图片工作台。
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <label htmlFor="api-url" className="block text-sm font-medium text-stone-700">
              上游 API URL
            </label>
            <div className="relative">
              <Globe className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
              <Input
                id="api-url"
                value={apiUrl}
                onChange={(event) => setApiUrl(event.target.value)}
                placeholder="https://your-newapi.example.com/v1"
                className="h-[52px] rounded-2xl border-stone-200 bg-white pl-11"
              />
            </div>
            <p className="text-xs leading-5 text-stone-500">建议直接填写 OpenAI 兼容基地址，通常以 /v1 结尾。</p>
          </div>

          <div className="space-y-3">
            <label htmlFor="api-key" className="block text-sm font-medium text-stone-700">
              上游 API Key
            </label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void handleLogin();
                  }
                }}
                placeholder="sk-..."
                className="h-[52px] rounded-2xl border-stone-200 bg-white pl-11"
              />
            </div>
          </div>

          <Button
            className="h-[52px] w-full rounded-2xl bg-stone-950 text-white hover:bg-stone-800"
            onClick={() => void handleLogin()}
            disabled={isSubmitting}
          >
            {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
            登录并验证
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
