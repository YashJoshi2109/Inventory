/**
 * Auth store (zustand + persist).
 *
 * Holds the current user plus access/refresh JWTs and drives `isAuthenticated`.
 * Persisted to localStorage under the key `sierlab-auth` (see `partialize` for
 * exactly which fields survive a reload). `apiClient` reads `accessToken` for the
 * Bearer header and calls `setTokens`/`logout` from its 401-refresh flow.
 *
 * Note: `hasRole` short-circuits to `true` for superusers (`user.is_superuser`),
 * so a superuser passes every role check regardless of assigned roles.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/types";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setUser: (user: User) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
  hasRole: (...roles: string[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      setUser: (user) => set({ user, isAuthenticated: true }),

      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken, isAuthenticated: true }),

      logout: () =>
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false }),

      hasRole: (...roles) => {
        const { user } = get();
        if (!user) return false;
        if (user.is_superuser) return true;
        const userRoles = new Set(user.roles.map((r) => r.name));
        return roles.some((r) => userRoles.has(r));
      },
    }),
    {
      name: "sierlab-auth",
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
