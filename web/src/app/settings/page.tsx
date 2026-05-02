"use client";

import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";

import { useLinkTemplatePlaceholders } from "@/lib/use-link-template-placeholders";
import { useAuthGuard } from "@/lib/use-auth-guard";

import { ConfigCard } from "./components/config-card";
import { useSettingsStore } from "./store";

function SettingsPageContent() {
  const didLoadRef = useRef(false);
  const loadConfig = useSettingsStore((state) => state.loadConfig);

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void loadConfig();
  }, [loadConfig]);

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-950">基础设置</h1>
        <p className="text-sm leading-6 text-stone-500">维护当前会话或管理员视角下的绘图接口配置。</p>
      </div>
      <ConfigCard />
    </section>
  );
}

export default function SettingsPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin", "user"]);
  useLinkTemplatePlaceholders(session);

  if (isCheckingAuth || !session) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <SettingsPageContent />;
}
