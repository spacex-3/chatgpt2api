"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { hasSettingsAutoLoginHint, resolveHomePageRedirectPath } from "@/lib/login-settings";
import { getStoredAuthSession, getStoredAuthSessionSync } from "@/store/auth";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    let active = true;

    const redirect = async () => {
      const search = typeof window !== "undefined" ? window.location.search : "";
      if (hasSettingsAutoLoginHint(search)) {
        router.replace(resolveHomePageRedirectPath(search, null));
        return;
      }

      const syncSession = getStoredAuthSessionSync();
      if (syncSession) {
        router.replace(resolveHomePageRedirectPath(search, syncSession.role));
        return;
      }

      const session = await getStoredAuthSession();
      if (!active) {
        return;
      }
      router.replace(resolveHomePageRedirectPath(search, session?.role || null));
    };

    void redirect();
    return () => {
      active = false;
    };
  }, [router]);

  return null;
}
