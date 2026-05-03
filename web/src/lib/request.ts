import axios, {AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig} from "axios";

import webConfig from "@/constants/common-env";
import { shouldReadStoredAuthKey } from "@/lib/request-auth";
import {clearStoredAuthSession, getStoredAuthKey, sanitizeNextRoute} from "@/store/auth";

type RequestConfig = AxiosRequestConfig & {
    redirectOnUnauthorized?: boolean;
    withStoredAuthKey?: boolean;
};

type ErrorPayload = {
    detail?: string | { error?: string | { message?: string } };
    error?: string | { message?: string };
    message?: string;
};

function errorMessageFromValue(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }
    if (!value || typeof value !== "object") {
        return "";
    }

    const item = value as { error?: unknown; message?: unknown };
    if (typeof item.message === "string") {
        return item.message;
    }
    return errorMessageFromValue(item.error);
}

const request = axios.create({
    baseURL: webConfig.apiUrl.replace(/\/$/, ""),
});

request.interceptors.request.use(async (config: InternalAxiosRequestConfig & RequestConfig) => {
    const headers = {...(config.headers || {})} as Record<string, string>;
    const hasAuthorizationHeader = Boolean(headers.Authorization || headers.authorization);
    if (shouldReadStoredAuthKey({
        withStoredAuthKey: config.withStoredAuthKey,
        hasAuthorizationHeader,
    })) {
        const authKey = await getStoredAuthKey();
        if (authKey) {
            headers.Authorization = `Bearer ${authKey}`;
        }
    }
    config.headers = headers as InternalAxiosRequestConfig["headers"];
    return config;
});

request.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<ErrorPayload>) => {
        const status = error.response?.status;
        const shouldRedirect = (error.config as RequestConfig | undefined)?.redirectOnUnauthorized !== false;
        if (status === 401 && shouldRedirect && typeof window !== "undefined") {
            // Avoid redirect loop — only redirect if not already on /login
            if (!window.location.pathname.startsWith("/login")) {
                await clearStoredAuthSession();
                const nextPath = sanitizeNextRoute(
                    `${window.location.pathname}${window.location.search}${window.location.hash}`,
                );
                window.location.replace(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
                // Return a never-resolving promise to prevent further error handling
                // while the browser navigates away
                return new Promise(() => {});
            }
        }

        const payload = error.response?.data;
        const message =
            errorMessageFromValue(payload?.detail) ||
            errorMessageFromValue(payload?.error) ||
            payload?.message ||
            error.message ||
            `请求失败 (${status || 500})`;
        return Promise.reject(new Error(message));
    },
);

type RequestOptions = {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    redirectOnUnauthorized?: boolean;
    withStoredAuthKey?: boolean;
};

export async function httpRequest<T>(path: string, options: RequestOptions = {}) {
    const {method = "GET", body, headers, redirectOnUnauthorized = true, withStoredAuthKey = true} = options;
    const config: RequestConfig = {
        url: path,
        method,
        data: body,
        headers,
        redirectOnUnauthorized,
        withStoredAuthKey,
    };
    const response = await request.request<T>(config);
    return response.data;
}
