import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import { useAuthStore } from "@/store/auth";
import { offlineQueue } from "@/offline/queue";

/**
 * API base URL (no trailing slash).
 * - Production on Vercel: use `/api/v1` so requests stay same-origin; vercel.json rewrites
 *   proxy to Render (avoids CORS on custom domains and fixes SPA catch-all eating `/api/*`).
 * - Override with VITE_API_URL for direct backend access (must list your web origin in CORS).
 */
function resolveApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL;
  if (raw === undefined || raw === null) return "/api/v1";
  const s = String(raw).trim();
  if (s === "") return "/api/v1";
  return s.replace(/\/+$/, "");
}

const BASE_URL = resolveApiBaseUrl();

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  // Render cold starts can exceed 15s; auth must survive first request after idle.
  timeout: 45_000,
  headers: { "Content-Type": "application/json" },
});

// ── Request interceptor: attach JWT ───────────────────────────────────────────
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: handle 401, offline queue ──────────────────────────
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    // Token expired — try refresh once
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = useAuthStore.getState().refreshToken;
        if (refreshToken) {
          const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refresh_token: refreshToken });
          useAuthStore.getState().setTokens(data.access_token, data.refresh_token);
          if (originalRequest.headers) {
            originalRequest.headers["Authorization"] = `Bearer ${data.access_token}`;
          }
          return apiClient(originalRequest);
        }
      } catch {
        useAuthStore.getState().logout();
      }
    }

    // Network offline — queue mutation for later sync
    if (!error.response && originalRequest.method && ["post", "patch", "delete"].includes(originalRequest.method.toLowerCase())) {
      await offlineQueue.enqueue({
        method: originalRequest.method.toUpperCase() as "POST" | "PATCH" | "DELETE",
        url: originalRequest.url ?? "",
        body: originalRequest.data ? JSON.parse(originalRequest.data) : undefined,
      });
    }

    return Promise.reject(error);
  }
);
