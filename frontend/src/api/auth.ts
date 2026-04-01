import { apiClient } from "./client";
import type { TokenResponse, User, RoleRequest } from "@/types";

export interface MessageResponse {
  message: string;
  success: boolean;
}

export interface PasskeyInfo {
  id: number;
  credential_id: string;
  device_name: string | null;
  aaguid: string | null;
  created_at: string;
  last_used_at: string | null;
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

  /** Request a password-reset OTP for the given email. */
  requestPasswordReset: async (email: string): Promise<MessageResponse> => {
    const { data } = await apiClient.post<MessageResponse>("/auth/password-reset/request", { email });
    return data;
  },

  /** Verify OTP and set a new password. */
  confirmPasswordReset: async (email: string, otp: string, newPassword: string): Promise<MessageResponse> => {
    const { data } = await apiClient.post<MessageResponse>("/auth/password-reset/confirm", {
      email,
      otp: otp.replace(/\D/g, "").slice(0, 6),
      new_password: newPassword,
    });
    return data;
  },
};

export const roleRequestApi = {
  /** List all pending role requests (managers/admins only). */
  list: async (status?: string): Promise<RoleRequest[]> => {
    const { data } = await apiClient.get<RoleRequest[]>("/auth/role-requests", {
      params: status ? { status } : undefined,
    });
    return data;
  },

  /** Get the current user's own latest role request. */
  getMy: async (): Promise<RoleRequest | null> => {
    const { data } = await apiClient.get<RoleRequest | null>("/auth/role-requests/my");
    return data;
  },

  /** Request manager role upgrade (for existing viewer users). */
  request: async (message?: string): Promise<RoleRequest> => {
    const { data } = await apiClient.post<RoleRequest>("/auth/role-requests", { message });
    return data;
  },

  /** Approve a pending role request (managers/admins only). */
  approve: async (id: number, reviewNote?: string): Promise<RoleRequest> => {
    const { data } = await apiClient.post<RoleRequest>(`/auth/role-requests/${id}/approve`, {
      review_note: reviewNote,
    });
    return data;
  },

  /** Reject a pending role request (managers/admins only). */
  reject: async (id: number, reviewNote?: string): Promise<RoleRequest> => {
    const { data } = await apiClient.post<RoleRequest>(`/auth/role-requests/${id}/reject`, {
      review_note: reviewNote,
    });
    return data;
  },
};

export const passkeyApi = {
  /** Start passkey registration (requires active JWT session). */
  registerBegin: async (): Promise<{ options: Record<string, unknown>; challenge_ticket: string }> => {
    const { data } = await apiClient.post<{ options: Record<string, unknown>; challenge_ticket: string }>("/passkeys/register/begin");
    return data;
  },

  /** Complete passkey registration. */
  registerComplete: async (credential: unknown, deviceName?: string, challengeTicket?: string): Promise<MessageResponse> => {
    const { data } = await apiClient.post<MessageResponse>("/passkeys/register/complete", {
      credential,
      device_name: deviceName,
      challenge_ticket: challengeTicket,
    });
    return data;
  },

  /** Start passkey login.
   * authenticatorType:
   *   "platform"       → Touch ID / Face ID / Windows Hello
   *   "cross-platform" → Another device via QR / NFC
   *   "security-key"   → USB/NFC FIDO2 key
   *   undefined        → no filter, browser picks
   */
  loginBegin: async (username?: string, authenticatorType?: string): Promise<{ options: Record<string, unknown>; challenge_ticket: string }> => {
    const { data } = await apiClient.post<{ options: Record<string, unknown>; challenge_ticket: string }>("/passkeys/login/begin", {
      username,
      authenticator_type: authenticatorType,
    });
    return data;
  },

  /** Complete passkey login. */
  loginComplete: async (credential: unknown, username?: string, challengeTicket?: string): Promise<TokenResponse> => {
    const { data } = await apiClient.post<TokenResponse>("/passkeys/login/complete", {
      credential,
      username,
      challenge_ticket: challengeTicket,
    });
    return data;
  },

  /** List registered passkeys for current user. */
  list: async (): Promise<PasskeyInfo[]> => {
    const { data } = await apiClient.get<PasskeyInfo[]>("/passkeys/");
    return data;
  },

  /** Delete a registered passkey. */
  delete: async (passkeyId: number): Promise<MessageResponse> => {
    const { data } = await apiClient.delete<MessageResponse>(`/passkeys/${passkeyId}`);
    return data;
  },
};
