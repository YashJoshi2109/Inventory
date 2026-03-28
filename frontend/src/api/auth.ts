import { apiClient } from "./client";
import type { TokenResponse, User } from "@/types";

export interface MessageResponse {
  message: string;
  success: boolean;
}

export interface RegisterPayload {
  username: string;
  password: string;
  email: string;
  full_name: string;
  role: "viewer" | "manager";
}

export const authApi = {
  login: async (username: string, password: string): Promise<TokenResponse> => {
    const { data } = await apiClient.post<TokenResponse>("/auth/login", { username, password });
    return data;
  },

  register: async (payload: RegisterPayload): Promise<TokenResponse> => {
    const { data } = await apiClient.post<TokenResponse>("/auth/register", payload);
    return data;
  },

  getMe: async (): Promise<User> => {
    const { data } = await apiClient.get<User>("/auth/me");
    return data;
  },

  refresh: async (refreshToken: string): Promise<TokenResponse> => {
    const { data } = await apiClient.post<TokenResponse>("/auth/refresh", { refresh_token: refreshToken });
    return data;
  },

  /** Request a 6-digit verification code by email (enumeration-safe response). */
  sendOtp: async (email: string): Promise<MessageResponse> => {
    const { data } = await apiClient.post<MessageResponse>("/auth/otp/send", { email });
    return data;
  },

  /** Verify OTP and receive fresh tokens (marks email verified on the server). */
  verifyOtp: async (email: string, otp: string): Promise<TokenResponse> => {
    const { data } = await apiClient.post<TokenResponse>("/auth/otp/verify", {
      email,
      otp: otp.replace(/\D/g, "").slice(0, 6),
    });
    return data;
  },
};
