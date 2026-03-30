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

/** One shared refresh so many parallel 401s do not stampede /auth/refresh. */
let refreshInFlight: Promise<{ access_token: string; refresh_token: string }> | null = null;

async function refreshSession(refreshToken: string): Promise<{ access_token: string; refresh_token: string }> {
  if (!refreshInFlight) {
    refreshInFlight = axios
      .post<{ access_token: string; refresh_token: string }>(`${BASE_URL}/auth/refresh`, {
        refresh_token: refreshToken,
      })
      .then((r) => r.data)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

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

    // Access token expired — refresh once per request, deduped across parallel 401s
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshToken = useAuthStore.getState().refreshToken;
      if (refreshToken) {
        try {
          const data = await refreshSession(refreshToken);
          useAuthStore.getState().setTokens(data.access_token, data.refresh_token);
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
          }
          return apiClient(originalRequest);
        } catch (refreshErr: unknown) {
          // Only clear the session when the server rejects the refresh token.
          // Network / 502 / timeout (common on cold Render) should not log the user out.
          const status = (refreshErr as { response?: { status?: number } })?.response?.status;
          if (status === 401) {
            useAuthStore.getState().logout();
          }
          return Promise.reject(refreshErr);
        }
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
