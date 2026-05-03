"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  getDefaultRouteForRole,
  getStoredAuthSession,
  getStoredAuthSessionSync,
  sanitizeNextRoute,
  type AuthRole,
  type StoredAuthSession,
} from "@/store/auth";

type UseAuthGuardResult = {
  isCheckingAuth: boolean;
  session: StoredAuthSession | null;
};

export function useAuthGuard(allowedRoles?: AuthRole[]): UseAuthGuardResult {
  const router = useRouter();
  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const allowedRolesKey = (allowedRoles || []).join(",");

  useEffect(() => {
    let active = true;

    const roleList = allowedRolesKey ? (allowedRolesKey.split(",") as AuthRole[]) : [];
    const applySession = (storedSession: StoredAuthSession | null) => {
      if (!storedSession) {
        setSession(null);
        setIsCheckingAuth(false);
        const nextPath = typeof window !== "undefined"
          ? sanitizeNextRoute(`${window.location.pathname}${window.location.search}${window.location.hash}`)
          : "";
        router.replace(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
        return true;
      }

      if (roleList.length > 0 && !roleList.includes(storedSession.role)) {
        setSession(storedSession);
        setIsCheckingAuth(false);
        router.replace(getDefaultRouteForRole(storedSession.role));
        return true;
      }

      setSession(storedSession);
      setIsCheckingAuth(false);
      return true;
    };

    const load = async () => {
      const syncSession = getStoredAuthSessionSync();
      if (syncSession) {
        applySession(syncSession);
        return;
      }
      const storedSession = await getStoredAuthSession();
      if (!active) {
        return;
      }
      applySession(storedSession);
    };

    void load();
    return () => {
      active = false;
    };
  }, [allowedRolesKey, router]);

  return { isCheckingAuth, session };
}

export function useRedirectIfAuthenticated(
  redirectPath?: string,
  options?: { ignoreStoredSession?: boolean },
) {
  const router = useRouter();
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const ignoreStoredSession = Boolean(options?.ignoreStoredSession);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (ignoreStoredSession) {
        setIsCheckingAuth(false);
        return;
      }
      const syncSession = getStoredAuthSessionSync();
      if (syncSession) {
        router.replace(sanitizeNextRoute(redirectPath) || getDefaultRouteForRole(syncSession.role));
        return;
      }
      const storedSession = await getStoredAuthSession();
      if (!active) {
        return;
      }

      if (storedSession) {
        router.replace(sanitizeNextRoute(redirectPath) || getDefaultRouteForRole(storedSession.role));
        return;
      }

      setIsCheckingAuth(false);
    };

    void load();
    return () => {
      active = false;
    };
  }, [ignoreStoredSession, redirectPath, router]);

  return { isCheckingAuth };
}
