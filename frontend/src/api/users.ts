import { apiClient } from "./client";

export interface UserRole {
  id: number;
  name: string;
  description?: string | null;
}

export interface UserRecord {
  id: number;
  email: string;
  username: string;
  full_name: string;
  is_active: boolean;
  is_superuser: boolean;
  email_verified: boolean;
  avatar_url?: string | null;
  last_login_at?: string | null;
  created_at: string;
  roles: UserRole[];
}

export interface UserCreatePayload {
  email: string;
  username: string;
  full_name: string;
  password: string;
  role_ids: number[];
}

export interface UserUpdatePayload {
  full_name?: string;
  email?: string;
  is_active?: boolean;
  role_ids?: number[];
}

export const usersApi = {
  list: async (): Promise<UserRecord[]> => {
    const { data } = await apiClient.get<UserRecord[]>("/users");
    return data;
  },

  listRoles: async (): Promise<UserRole[]> => {
    const { data } = await apiClient.get<UserRole[]>("/users/roles");
    return data;
  },

  create: async (payload: UserCreatePayload): Promise<UserRecord> => {
    const { data } = await apiClient.post<UserRecord>("/users", payload);
    return data;
  },

  update: async (id: number, payload: UserUpdatePayload): Promise<UserRecord> => {
    const { data } = await apiClient.patch<UserRecord>(`/users/${id}`, payload);
    return data;
  },

  deactivate: async (id: number): Promise<void> => {
    await apiClient.delete(`/users/${id}`);
  },

  resetPassword: async (id: number, newPassword: string): Promise<void> => {
    await apiClient.post(`/users/${id}/reset-password`, { new_password: newPassword });
  },

  bulkDelete: async (ids: number[]): Promise<void> => {
    await apiClient.delete("/users/bulk", { data: ids });
  },
};
