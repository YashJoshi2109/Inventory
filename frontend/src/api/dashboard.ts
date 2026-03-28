import { apiClient } from "./client";

export interface EmailServiceStatus {
  active_provider: string | null;
  brevo_configured: boolean;
  resend_configured: boolean;
  smtp_configured: boolean;
  daily_limit_hint: number | null;
  brevo_credits_remaining: number | null;
  note: string;
}

export const dashboardApi = {
  getEmailServiceStatus: async (): Promise<EmailServiceStatus> => {
    const { data } = await apiClient.get<EmailServiceStatus>("/dashboard/email-service-status");
    return data;
  },
};
