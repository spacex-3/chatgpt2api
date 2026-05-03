import { httpRequest } from "@/lib/request";

export type ImageModel = "gpt-image-2";
export type AuthRole = "admin" | "user";
export type SettingsScope = "admin" | "user";

export type SettingsConfig = {
  upstream_api_url: string;
  upstream_api_key: string;
  upstream_api_key_masked?: string;
  upstream_api_key_configured?: boolean;
  env_managed_fields?: string[];
  proxy: string;
  base_url?: string;
  image_retention_days?: number | string;
  max_images_per_request?: number | string;
  model?: ImageModel;
};

export type ImageTaskImage = { b64_json?: string; url?: string; revised_prompt?: string };

export type ImageTask = {
  id: string;
  status: "queued" | "running" | "success" | "error";
  mode: "generate" | "edit";
  model?: ImageModel;
  size?: string;
  n?: number;
  prompt?: string;
  conversation_id?: string;
  conversation_title?: string;
  owner_id?: string;
  owner_name?: string;
  owner_role?: AuthRole;
  credential_id?: string;
  credential_label?: string;
  created_at: string;
  updated_at: string;
  result_count?: number;
  data?: ImageTaskImage[];
  error?: string;
};

type ImageTaskListResponse = {
  items: ImageTask[];
  missing_ids: string[];
};

export type LoginResponse = {
  ok: boolean;
  version: string;
  role: AuthRole;
  subject_id: string;
  name: string;
  session_token: string;
  config: SettingsConfig;
};

export type SettingsResponse = {
  config: SettingsConfig;
  role?: AuthRole;
  scope?: SettingsScope;
  subject_id?: string;
  name?: string;
  session_token?: string;
};

export async function login(upstreamApiUrl: string, upstreamApiKey: string) {
  return httpRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: {
      upstream_api_url: String(upstreamApiUrl || "").trim(),
      upstream_api_key: String(upstreamApiKey || "").trim(),
    },
    redirectOnUnauthorized: false,
    withStoredAuthKey: false,
  });
}

export async function adminLogin(password: string) {
  return httpRequest<LoginResponse>("/auth/admin/login", {
    method: "POST",
    body: {
      password: String(password || "").trim(),
    },
    redirectOnUnauthorized: false,
    withStoredAuthKey: false,
  });
}

export async function createImageGenerationTask(
  clientTaskId: string,
  prompt: string,
  n: number,
  size?: string,
  conversationId?: string,
  conversationTitle?: string,
) {
  return httpRequest<ImageTask>("/api/image-tasks/generations", {
    method: "POST",
    body: {
      client_task_id: clientTaskId,
      prompt,
      model: "gpt-image-2",
      n,
      ...(size ? { size } : {}),
      ...(conversationId ? { conversation_id: conversationId } : {}),
      ...(conversationTitle ? { conversation_title: conversationTitle } : {}),
    },
  });
}

export async function createImageEditTask(
  clientTaskId: string,
  files: File | File[],
  prompt: string,
  n: number,
  size?: string,
  conversationId?: string,
  conversationTitle?: string,
) {
  const formData = new FormData();
  const uploadFiles = Array.isArray(files) ? files : [files];
  uploadFiles.forEach((file) => {
    formData.append("image", file);
  });
  formData.append("client_task_id", clientTaskId);
  formData.append("prompt", prompt);
  formData.append("model", "gpt-image-2");
  formData.append("n", String(n));
  if (size) {
    formData.append("size", size);
  }
  if (conversationId) {
    formData.append("conversation_id", conversationId);
  }
  if (conversationTitle) {
    formData.append("conversation_title", conversationTitle);
  }
  return httpRequest<ImageTask>("/api/image-tasks/edits", {
    method: "POST",
    body: formData,
  });
}

export async function fetchImageTasks(ids: string[]) {
  const params = new URLSearchParams();
  if (ids.length > 0) {
    params.set("ids", ids.join(","));
  }
  return httpRequest<ImageTaskListResponse>(`/api/image-tasks${params.toString() ? `?${params.toString()}` : ""}`);
}

export async function deleteImageTaskConversation(conversationId: string) {
  return httpRequest<{ ok: boolean; deleted: number }>(`/api/image-tasks/conversations/${encodeURIComponent(conversationId)}`, {
    method: "DELETE",
  });
}

export async function clearImageTaskHistory() {
  return httpRequest<{ ok: boolean; deleted: number }>("/api/image-tasks/history", {
    method: "DELETE",
  });
}

export async function fetchAdminImageTasks(limit = 200) {
  return httpRequest<ImageTaskListResponse>(`/api/admin/image-tasks?limit=${encodeURIComponent(String(limit))}`);
}

export async function fetchSettingsConfig() {
  return httpRequest<SettingsResponse>("/api/settings");
}

export async function updateSettingsConfig(settings: Partial<SettingsConfig>) {
  return httpRequest<SettingsResponse>("/api/settings", {
    method: "POST",
    body: settings,
  });
}
