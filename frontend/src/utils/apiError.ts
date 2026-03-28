import { AxiosError } from "axios";

/** Normalize FastAPI `detail` (string | validation object[]) and network errors for toasts. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    if (error.code === "ECONNABORTED") {
      return "Request timed out. The server may be starting up—try again in a few seconds.";
    }
    if (!error.response && error.message === "Network Error") {
      return "Network error. Check your connection and that the API URL is configured for this deployment.";
    }
    const detail = error.response?.data as { detail?: unknown } | undefined;
    const d = detail?.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      const parts = d
        .map((item) => {
          if (item && typeof item === "object" && "msg" in item) {
            return String((item as { msg: unknown }).msg);
          }
          return null;
        })
        .filter(Boolean);
      if (parts.length) return parts.join("; ");
    }
  }
  return fallback;
}
