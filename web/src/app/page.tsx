"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { getDefaultRouteForRole, getStoredAuthSession, sanitizeNextRoute } from "@/store/auth";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    let active = true;

    const redirect = async () => {
      const session = await getStoredAuthSession();
      if (!active) {
        return;
      }
      const queryString = typeof window !== "undefined"
        ? window.location.search.replace(/^\?/, "")
        : "";
      const target = session ? getDefaultRouteForRole(session.role) : "/image";
      const nextRoute = sanitizeNextRoute(`${target}${queryString ? `?${queryString}` : ""}`);
      router.replace(session ? nextRoute : `/login?next=${encodeURIComponent(nextRoute || "/image")}`);
    };

    void redirect();
    return () => {
      active = false;
    };
  }, [router]);

  return null;
}
