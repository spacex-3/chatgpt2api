export type StoredAuthSessionShape = {
  key: string;
  role: "admin" | "user";
  subjectId: string;
  name: string;
};

export function normalizeStoredAuthSession(value: unknown, fallbackKey = ""): StoredAuthSessionShape | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<StoredAuthSessionShape>;
  const key = String(candidate.key || fallbackKey || "").trim();
  if (!key) {
    return null;
  }
  const role: StoredAuthSessionShape["role"] = candidate.role === "user" ? "user" : "admin";

  return {
    key,
    role,
    subjectId: String(candidate.subjectId || "upstream-admin").trim() || "upstream-admin",
    name: String(candidate.name || (role === "admin" ? "系统管理员" : "图片用户")).trim() || (role === "admin" ? "系统管理员" : "图片用户"),
  };
}

export function parseStoredAuthSessionValue(value: string | null | undefined): unknown {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

export function serializeStoredAuthSession(session: StoredAuthSessionShape): string {
  return JSON.stringify(session);
}
