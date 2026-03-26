import { apiClient } from "./client";

export interface ChatRateLimitStatus {
  ip: string;
  limit: number;
  window_seconds: number;
  used: number;
  remaining: number;
  retry_after_seconds: number;
}

export const rateLimitApi = {
  getChatRateLimit: async (): Promise<ChatRateLimitStatus> => {
    const { data } = await apiClient.get<ChatRateLimitStatus>("/ai/rate-limit");
    return data;
  },
};

