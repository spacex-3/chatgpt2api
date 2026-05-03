"use client";

import localforage from "localforage";
import {
  normalizeStoredAuthSession,
  parseStoredAuthSessionValue,
  serializeStoredAuthSession,
  type StoredAuthSessionShape,
} from "./auth-storage";

export type AuthRole = "admin" | "user";

export type StoredAuthSession = StoredAuthSessionShape;

export const AUTH_KEY_STORAGE_KEY = "chatgpt2api_auth_key";
export const AUTH_SESSION_STORAGE_KEY = "chatgpt2api_auth_session";

const authStorage = localforage.createInstance({
  name: "chatgpt2api",
  storeName: "auth",
});

let memoryAuthKey: string | null = null;
let memoryAuthSession: StoredAuthSession | null = null;
let hasMemoryAuthKey = false;
let hasMemoryAuthSession = false;

export function getDefaultRouteForRole(role: AuthRole) {
  return role === "admin" ? "/admin" : "/image";
}

export function sanitizeNextRoute(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized.startsWith("/") || normalized.startsWith("//") || normalized.startsWith("/login")) {
    return "";
  }
  return normalized;
}

function readLocalStorageValue(key: string) {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return String(window.localStorage.getItem(key) || "").trim();
  } catch {
    return "";
  }
}

function writeLocalStorageValue(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore localStorage failures and keep in-memory snapshot
  }
}

function removeLocalStorageValue(key: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore localStorage failures and keep in-memory snapshot
  }
}

function rememberAuthKey(key: string) {
  hasMemoryAuthKey = true;
  memoryAuthKey = key || null;
}

function rememberAuthSession(session: StoredAuthSession | null) {
  hasMemoryAuthSession = true;
  memoryAuthSession = session;
  if (session?.key) {
    rememberAuthKey(session.key);
  } else if (session === null) {
    rememberAuthKey("");
  }
}

function readLocalStorageSession() {
  const storedKey = readLocalStorageValue(AUTH_KEY_STORAGE_KEY);
  const storedSession = parseStoredAuthSessionValue(readLocalStorageValue(AUTH_SESSION_STORAGE_KEY));
  return normalizeStoredAuthSession(storedSession, storedKey);
}

function writeSyncAuthSnapshot(session: StoredAuthSession) {
  rememberAuthSession(session);
  writeLocalStorageValue(AUTH_KEY_STORAGE_KEY, session.key);
  writeLocalStorageValue(AUTH_SESSION_STORAGE_KEY, serializeStoredAuthSession(session));
}

function clearSyncAuthSnapshot() {
  rememberAuthSession(null);
  removeLocalStorageValue(AUTH_KEY_STORAGE_KEY);
  removeLocalStorageValue(AUTH_SESSION_STORAGE_KEY);
}

export function getStoredAuthKeySync() {
  if (typeof window === "undefined") {
    return "";
  }
  if (hasMemoryAuthSession && memoryAuthSession?.key) {
    return memoryAuthSession.key;
  }
  if (hasMemoryAuthKey) {
    return String(memoryAuthKey || "");
  }
  const storedKey = readLocalStorageValue(AUTH_KEY_STORAGE_KEY);
  if (storedKey) {
    rememberAuthKey(storedKey);
    return storedKey;
  }
  const storedSession = readLocalStorageSession();
  if (storedSession) {
    rememberAuthSession(storedSession);
    return storedSession.key;
  }
  return "";
}

export function getStoredAuthSessionSync() {
  if (typeof window === "undefined") {
    return null;
  }
  if (hasMemoryAuthSession) {
    return memoryAuthSession;
  }
  const storedSession = readLocalStorageSession();
  if (storedSession) {
    rememberAuthSession(storedSession);
    return storedSession;
  }
  return null;
}

export async function getStoredAuthKey() {
  const syncKey = getStoredAuthKeySync();
  if (syncKey) {
    return syncKey;
  }
  if (typeof window === "undefined") {
    return "";
  }
  try {
    const value = await authStorage.getItem<string>(AUTH_KEY_STORAGE_KEY);
    const normalizedKey = String(value || "").trim();
    if (normalizedKey) {
      rememberAuthKey(normalizedKey);
      writeLocalStorageValue(AUTH_KEY_STORAGE_KEY, normalizedKey);
    }
    return normalizedKey;
  } catch {
    return "";
  }
}

export async function getStoredAuthSession() {
  const syncSession = getStoredAuthSessionSync();
  if (syncSession) {
    return syncSession;
  }
  if (typeof window === "undefined") {
    return null;
  }
  let storedKey = "";
  try {
    const result = await Promise.all([
      authStorage.getItem<string>(AUTH_KEY_STORAGE_KEY),
      authStorage.getItem<StoredAuthSession>(AUTH_SESSION_STORAGE_KEY),
    ]);
    storedKey = String(result[0] || "").trim();
    const normalizedSession = normalizeStoredAuthSession(result[1], storedKey);
    if (normalizedSession) {
      writeSyncAuthSnapshot(normalizedSession);
      if (normalizedSession.key !== storedKey) {
        void authStorage.setItem(AUTH_KEY_STORAGE_KEY, normalizedSession.key).catch(() => {});
      }
      return normalizedSession;
    }
  } catch {
    return null;
  }

  if (storedKey) {
    await clearStoredAuthSession();
  }
  return null;
}

export async function setStoredAuthSession(session: StoredAuthSession) {
  const normalizedSession = normalizeStoredAuthSession(session);
  if (!normalizedSession) {
    await clearStoredAuthSession();
    return;
  }

  writeSyncAuthSnapshot(normalizedSession);
  void Promise.all([
    authStorage.setItem(AUTH_KEY_STORAGE_KEY, normalizedSession.key),
    authStorage.setItem(AUTH_SESSION_STORAGE_KEY, normalizedSession),
  ]).catch(() => {});
}

export async function clearStoredAuthSession() {
  clearSyncAuthSnapshot();
  if (typeof window === "undefined") {
    return;
  }
  void Promise.all([
    authStorage.removeItem(AUTH_KEY_STORAGE_KEY),
    authStorage.removeItem(AUTH_SESSION_STORAGE_KEY),
  ]).catch(() => {});
}
