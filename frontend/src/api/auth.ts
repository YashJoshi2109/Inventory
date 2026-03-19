import { apiClient } from "./client";
import type { TokenResponse, User } from "@/types";

export const authApi = {
  login: async (username: string, password: string): Promise<TokenResponse> => {
    const { data } = await apiClient.post<TokenResponse>("/auth/login", { username, password });
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
};
