// Minimal fetch wrapper. Base is empty because Vite proxies /api in dev and the
// SPA is served same-origin in prod.

import { getAuthToken, notifyUnauthorized } from "../auth/token";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function authHeaders(base?: HeadersInit): Headers {
  const headers = new Headers(base);
  const token = getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

function rejectIfUnauthorized(path: string, status: number) {
  if (status !== 401 || path.startsWith("/api/auth/")) return;
  notifyUnauthorized();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = authHeaders(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(path, {
    ...init,
    headers,
  });
  if (!res.ok) {
    rejectIfUnauthorized(path, res.status);
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: async <T>(path: string, formData: FormData): Promise<T> => {
    const res = await fetch(path, { method: "POST", body: formData, headers: authHeaders() });
    if (!res.ok) {
      rejectIfUnauthorized(path, res.status);
      let detail: unknown = res.statusText;
      try {
        const body = await res.json();
        detail = body.detail ?? detail;
      } catch {
        /* non-JSON error body */
      }
      const message =
        typeof detail === "string"
          ? detail
          : detail && typeof detail === "object" && "message" in detail
            ? String((detail as { message: unknown }).message)
            : JSON.stringify(detail);
      throw new ApiError(res.status, message);
    }
    return (await res.json()) as T;
  },
  download: async (path: string, filename: string) => {
    const res = await fetch(path, { headers: authHeaders() });
    if (!res.ok) {
      rejectIfUnauthorized(path, res.status);
      throw new ApiError(res.status, res.statusText);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
  postDownload: async (path: string, body: unknown, filename: string) => {
    const headers = authHeaders({ "Content-Type": "application/json" });
    const res = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      rejectIfUnauthorized(path, res.status);
      throw new ApiError(res.status, res.statusText);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};

