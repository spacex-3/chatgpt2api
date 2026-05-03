export type AutoLoginCredentials = {
  upstreamApiUrl: string;
  upstreamApiKey: string;
};

type SessionRole = "admin" | "user";

type LoginPageState = {
  nextRoute: string;
  autoLoginCredentials: AutoLoginCredentials | null;
  hasAutoLoginHint: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSearch(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.startsWith("?") ? normalized.slice(1) : normalized;
}

function normalizeApiUrl(value: unknown) {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }
  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.host) {
      return "";
    }
    return normalized;
  } catch {
    return "";
  }
}

function normalizeApiKey(value: unknown) {
  return String(value || "").trim();
}

function sanitizeNextRoute(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized.startsWith("/") || normalized.startsWith("//") || normalized.startsWith("/login")) {
    return "";
  }
  return normalized;
}

function settingsParamFromRoute(route: string | null | undefined) {
  const sanitizedRoute = sanitizeNextRoute(route);
  if (!sanitizedRoute) {
    return "";
  }
  const parsed = new URL(sanitizedRoute, "http://local.test");
  return parsed.searchParams.get("settings") || "";
}

function routeHasSettingsParam(route: string | null | undefined) {
  return Boolean(settingsParamFromRoute(route));
}

function buildImageRouteFromSearch(search: string | null | undefined) {
  const queryString = normalizeSearch(search);
  return sanitizeNextRoute(`/image${queryString ? `?${queryString}` : ""}`) || "/image";
}

function getDefaultRouteForRole(role: SessionRole) {
  return role === "admin" ? "/admin" : "/image";
}

export function parseSettingsAutoLoginCredentials(rawSettings: string | null | undefined): AutoLoginCredentials | null {
  const normalizedSettings = String(rawSettings || "").trim();
  if (!normalizedSettings) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalizedSettings);
    if (!isRecord(parsed)) {
      return null;
    }
    const keyVaults = isRecord(parsed.keyVaults) ? parsed.keyVaults : null;
    const openai = keyVaults && isRecord(keyVaults.openai) ? keyVaults.openai : null;
    if (!openai) {
      return null;
    }

    const upstreamApiKey = normalizeApiKey(openai.apiKey);
    const upstreamApiUrl = normalizeApiUrl(openai.baseURL);
    if (!upstreamApiKey || !upstreamApiUrl) {
      return null;
    }

    return {
      upstreamApiKey,
      upstreamApiUrl,
    };
  } catch {
    return null;
  }
}

export function stripSettingsFromRoute(route: string | null | undefined) {
  const sanitizedRoute = sanitizeNextRoute(route);
  if (!sanitizedRoute) {
    return "";
  }
  const parsed = new URL(sanitizedRoute, "http://local.test");
  parsed.searchParams.delete("settings");
  return sanitizeNextRoute(`${parsed.pathname}${parsed.search}${parsed.hash}`);
}

export function hasSettingsAutoLoginHint(search: string | null | undefined) {
  const params = new URLSearchParams(normalizeSearch(search));
  return Boolean(params.get("settings")) || routeHasSettingsParam(params.get("next"));
}

export function resolveLoginPageState(search: string | null | undefined): LoginPageState {
  const params = new URLSearchParams(normalizeSearch(search));
  const nextRoute = stripSettingsFromRoute(params.get("next"));
  const directCredentials = parseSettingsAutoLoginCredentials(params.get("settings"));
  const nextCredentials = directCredentials ? null : parseSettingsAutoLoginCredentials(settingsParamFromRoute(params.get("next")));
  const hasAutoLoginHint = hasSettingsAutoLoginHint(search);

  return {
    nextRoute,
    autoLoginCredentials: directCredentials || nextCredentials,
    hasAutoLoginHint,
  };
}

export function buildAutoLoginSignature(credentials: AutoLoginCredentials | null, nextRoute: string) {
  if (!credentials) {
    return "";
  }
  return `${credentials.upstreamApiUrl}\n${credentials.upstreamApiKey}\n${nextRoute}`;
}

export function resolveHomePageRedirectPath(search: string | null | undefined, role: SessionRole | null) {
  const nextRoute = buildImageRouteFromSearch(search);
  if (hasSettingsAutoLoginHint(search) || !role) {
    return `/login?next=${encodeURIComponent(nextRoute)}`;
  }

  const target = getDefaultRouteForRole(role);
  const currentSearch = normalizeSearch(search);
  const redirectRoute = stripSettingsFromRoute(`${target}${currentSearch ? `?${currentSearch}` : ""}`);
  return redirectRoute || target;
}
