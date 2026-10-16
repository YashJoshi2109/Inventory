// IP-based copilot rate limit (shared across all users on an IP, per time window).
// Distinct from sandbox.ts, which tracks a per-user sandbox message quota.
import { apiClient } from "./client";

export interface ChatRateLimitStatus {
  ip: string;
  limit: number;
  window_seconds: number;
  used: number;
  remaining: number;
  retry_after_seconds: number;
  provider?: string;
  model?: string;
}

export const rateLimitApi = {
  getChatRateLimit: async (): Promise<ChatRateLimitStatus> => {
    const { data } = await apiClient.get<ChatRateLimitStatus>("/ai/rate-limit");
    return data;
  },
};

