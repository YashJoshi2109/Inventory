// Per-user sandbox message quota (how many copilot messages this user has left
// in sandbox mode). Distinct from rateLimit.ts, which is an IP-based rate limit.
import { apiClient } from "./client";

export interface CopilotQuota {
  msgs_used: number;
  limit: number;
  remaining: number;
  is_sandbox: boolean;
}

export const sandboxApi = {
  getCopilotQuota: async (): Promise<CopilotQuota> => {
    const { data } = await apiClient.get<CopilotQuota>("/sandbox/copilot-quota");
    return data;
  },
};
