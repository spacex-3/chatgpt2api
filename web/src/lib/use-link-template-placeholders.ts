"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { fetchSettingsConfig } from "@/lib/api";
import type { StoredAuthSession } from "@/store/auth";

function normalizeServerAddress(value: string) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/i, "");
}

function hasTemplateToken(value: string) {
  return value.includes("{key}") || value.includes("{address}");
}

function replaceTemplateTokens(value: string, key: string, address: string) {
  return value
    .replaceAll("{key}", key)
    .replaceAll("{address}", address);
}

export function useLinkTemplatePlaceholders(session: StoredAuthSession | null) {
  const processedRef = useRef("");
  const pathname = usePathname();
  const locationKey = typeof window !== "undefined"
    ? `${window.location.pathname}${window.location.search}${window.location.hash}`
    : pathname;

  useEffect(() => {
    if (!session || session.role !== "user" || typeof window === "undefined") {
      return;
    }

    const currentUrl = new URL(window.location.href);
    const signature = currentUrl.toString();
    if (processedRef.current === signature) {
      return;
    }

    const searchEntries = Array.from(currentUrl.searchParams.entries());
    const hasTemplates =
      searchEntries.some(([, value]) => hasTemplateToken(value))
      || hasTemplateToken(currentUrl.hash);
    if (!hasTemplates) {
      processedRef.current = signature;
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const data = await fetchSettingsConfig();
        if (cancelled) {
          return;
        }
        const key = String(data.config.upstream_api_key || "").trim();
        const address = normalizeServerAddress(
          String(data.config.base_url || "").trim() || window.location.origin,
        );
        if (!key || !address) {
          return;
        }

        let changed = false;
        const nextUrl = new URL(window.location.href);

        searchEntries.forEach(([paramKey, paramValue]) => {
          if (!hasTemplateToken(paramValue)) {
            return;
          }
          const nextValue = replaceTemplateTokens(paramValue, key, address);
          if (nextValue !== paramValue) {
            nextUrl.searchParams.set(paramKey, nextValue);
            changed = true;
          }
        });

        if (hasTemplateToken(nextUrl.hash)) {
          const nextHash = replaceTemplateTokens(nextUrl.hash, key, address);
          if (nextHash !== nextUrl.hash) {
            nextUrl.hash = nextHash;
            changed = true;
          }
        }

        if (!changed) {
          processedRef.current = nextUrl.toString();
          return;
        }

        window.history.replaceState(window.history.state, "", nextUrl.toString());
        processedRef.current = nextUrl.toString();
      } catch {
        // ignore and keep the original template URL
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [locationKey, pathname, session]);
}
